import { encodeFileContentMessage } from './protocol.js';
import {
  applyFields,
  readFields,
  fieldVersion,
  equalValue,
  entityKey,
  commandKeys,
  commandReferences,
  remapCommand,
  commandFileHash,
  moveRows,
  sortedRows,
  MAX_BATCH_BYTES,
  MAX_BATCH_COMMANDS,
  MAX_RESULT_BYTES,
  type RecordValue,
  type RoomCommand,
  type RoomOperation,
  type BatchResult,
  type ServerMessage,
  type RoomDelta,
  type EntityKind,
} from './sync-protocol.js';
export type Draft = { id: string; command: RoomCommand; dependencies: string[]; baseValues: RecordValue };
export type SyncConflict = Draft & { reason: string; current?: RecordValue };
export type SyncJournal = {
  epoch: string;
  commitVersion: number;
  clientId: string | null;
  lastProcessedSeq: number;
  layers: RecordValue[];
  features: RecordValue[];
  pending: Draft[];
  conflicts: SyncConflict[];
  inFlight: { operation: RoomOperation; entryIds: string[] } | null;
  files: Record<string, Blob>;
  aliases: Record<string, string>;
};
type Options = {
  send: (message: object | Uint8Array) => boolean;
  publish: (layers: any[], features: any[]) => void;
  changed?: () => void;
  remap?: (ids: Record<string, string>) => void;
  save?: (journal: SyncJournal) => Promise<void> | void;
  load?: () => Promise<SyncJournal | undefined>;
  journal?: SyncJournal;
  batchDelay?: number;
  settled?: (result: BatchResult, drafts: Draft[]) => void;
};
export class SyncView {
  layers = new Map<string, RecordValue>();
  features = new Map<string, RecordValue>();
  replace(layers: RecordValue[], features: RecordValue[]) {
    this.layers = new Map(layers.map((row) => [row.id, structuredClone(row)]));
    this.features = new Map(
      features
        .filter((row) => this.layers.get(row.layerId)?.kind === 'annotation')
        .map((row) => [row.id, structuredClone(row)]),
    );
  }
  getLayer(id: string) {
    return this.layers.get(id) || null;
  }
  getAnnotationFeature(id: string) {
    return this.features.get(id) || null;
  }
  getLayers() {
    return sortedRows([...this.layers.values()]);
  }
  getAnnotationFeatures(layerId?: string) {
    return sortedRows([...this.features.values()].filter((row) => !layerId || row.layerId === layerId));
  }
  get(kind: EntityKind, id: string) {
    return kind === 'layer' ? this.getLayer(id) : this.getAnnotationFeature(id);
  }
  set(kind: EntityKind, row: RecordValue) {
    (kind === 'layer' ? this.layers : this.features).set(row.id, row);
  }
  delete(kind: EntityKind, id: string) {
    (kind === 'layer' ? this.layers : this.features).delete(id);
    if (kind === 'layer') for (const [key, row] of this.features) if (row.layerId === id) this.features.delete(key);
  }
  delta(delta: RoomDelta) {
    for (const id of delta.deletedLayers) this.delete('layer', id);
    for (const id of delta.deletedFeatures) this.delete('feature', id);
    for (const row of delta.layers) this.set('layer', row);
    for (const row of delta.features) if (this.layers.get(row.layerId)?.kind === 'annotation') this.set('feature', row);
  }
  project(c: RoomCommand) {
    if (c.type === 'create') {
      const row: RecordValue = { ...c.data, id: c.localId, fieldVersions: {}, revision: 0 };
      if (c.kind === 'feature') {
        if (!this.layers.has(row.layerId)) return;
        row.payload = { ...row.payload, id: c.localId };
      }
      this.set(c.kind, row);
    } else if (c.type === 'delete') this.delete(c.kind, c.id);
    else {
      const row = this.get(c.kind, c.id);
      if (!row) return;
      if (c.type === 'patch')
        this.set(
          c.kind,
          applyFields(
            c.kind,
            row,
            Object.fromEntries(Object.entries(c.fields).map(([key, value]) => [key, value.value])),
          ),
        );
      else {
        const rows = c.kind === 'layer' ? this.getLayers() : this.getAnnotationFeatures(row.layerId);
        for (const moved of moveRows(rows, c.id, c.beforeId)) this.set(c.kind, moved);
      }
    }
  }
}
export class RoomSyncClient {
  canonical = new SyncView();
  view = new SyncView();
  epoch = '';
  commitVersion = 0;
  clientId: string | null = null;
  lastProcessedSeq = 0;
  ready = false;
  writable = false;
  connected = false;
  storageError = '';
  pending: Draft[] = [];
  conflicts: SyncConflict[] = [];
  files: Record<string, Blob> = {};
  aliases: Record<string, string> = Object.create(null);
  inFlight: SyncJournal['inFlight'] = null;
  lastOutcome: BatchResult | null = null;
  uploaded = new Set<string>();
  uploading = new Set<string>();
  loaded: Promise<void>;
  private settledEvents: Array<{ result: BatchResult; drafts: Draft[] }> = [];
  private saving = Promise.resolve();
  private writeScheduled = false;
  private dirty = false;
  private receiving = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pumpTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempt = 0;
  private requestPending = false;
  private sent = false;
  private pumping = false;
  private preparingIds = new Set<string>();
  private generation = 0;
  private disposed = false;
  private recoveringExpired = false;
  constructor(private options: Options) {
    this.loaded = Promise.resolve(options.journal || options.load?.())
      .then((journal) => {
        if (journal) {
          this.epoch = journal.epoch;
          this.commitVersion = journal.commitVersion;
          this.clientId = journal.clientId;
          this.lastProcessedSeq = journal.lastProcessedSeq;
          this.pending = journal.pending;
          this.conflicts = journal.conflicts;
          this.files = journal.files;
          this.aliases = Object.assign(Object.create(null), journal.aliases);
          this.inFlight = journal.inFlight;
          this.canonical.replace(journal.layers, journal.features);
        }
        this.project(false);
      })
      .catch((error) => {
        this.storageError =
          error instanceof Error
            ? error.message
            : 'Could not read saved edits. Your stored draft has not been overwritten.';
        this.options.changed?.();
      });
  }
  journal(): SyncJournal {
    return {
      epoch: this.epoch,
      commitVersion: this.commitVersion,
      clientId: this.clientId,
      lastProcessedSeq: this.lastProcessedSeq,
      layers: this.canonical.getLayers(),
      features: this.canonical.getAnnotationFeatures(),
      pending: this.pending,
      conflicts: this.conflicts,
      inFlight: this.inFlight,
      files: this.files,
      aliases: this.aliases,
    };
  }
  async exportJournal() {
    const journal = structuredClone(this.journal());
    const files: Record<string, string> = {};
    for (const [hash, blob] of Object.entries(journal.files))
      files[hash] = btoa(
        Array.from(new Uint8Array(await blob.arrayBuffer()), (byte) => String.fromCharCode(byte)).join(''),
      );
    return { ...journal, files };
  }
  private checkpoint() {
    // Coalesced journal writer: only one save loop runs at a time. While it is
    // running, further checkpoints mark the store dirty and resolve together on
    // the same promise, so a burst of enqueues blocks on one write (or two) and
    // the last state is guaranteed persisted before any caller resolves — an
    // offline draft survives a closed tab, and bursts stay batched.
    if (this.writeScheduled) {
      this.dirty = true;
      return this.saving;
    }
    this.writeScheduled = true;
    this.saving = (async () => {
      do {
        this.dirty = false;
        const current = structuredClone(this.journal());
        await this.options.save?.(current);
      } while (this.dirty);
      this.writeScheduled = false;
    })().then(
      () => {
        this.storageError = '';
        this.options.changed?.();
      },
      () => {
        this.storageError = 'Could not save edits on this device. Keep this tab open and export your edits.';
        this.options.changed?.();
      },
    );
    return this.saving;
  }
  private project(publish = true) {
    this.view.replace(this.canonical.getLayers(), this.canonical.getAnnotationFeatures());
    for (const draft of this.pending) this.view.project(draft.command);
    if (publish) this.options.publish(this.view.getLayers(), this.view.getAnnotationFeatures());
  }
  private resolve(id: string) {
    return this.aliases[id] || id;
  }
  async enqueue(mutation: RecordValue, file?: { hash: string; bytes: Uint8Array }): Promise<string[]> {
    await this.loaded;
    if (file) this.files[file.hash] = new Blob([new Uint8Array(file.bytes).buffer]);
    const commands = this.commandsFor(mutation);
    const ids: string[] = [];
    for (const command of commands) {
      const keys = commandKeys(command);
      const refs = commandReferences(command);
      const dependencies = this.pending
        .filter(
          (draft) =>
            commandKeys(draft.command).some((key) => keys.includes(key)) ||
            (draft.command.type === 'create' && refs.includes(draft.command.localId)),
        )
        .map((draft) => draft.id);
      const row = command.type === 'create' ? null : this.view.get(command.kind, command.id);
      const baseValues = row ? readFields(command.kind, row) : {};
      const merge =
        command.type === 'patch'
          ? this.pending
              .slice(-1)
              .find(
                (draft) =>
                  !this.inFlight?.entryIds.includes(draft.id) &&
                  !this.preparingIds.has(draft.id) &&
                  draft.command.type === 'patch' &&
                  draft.command.kind === command.kind &&
                  draft.command.id === command.id &&
                  equalValue(Object.keys(draft.command.fields).sort(), Object.keys(command.fields).sort()),
              )
          : undefined;
      if (merge && merge.command.type === 'patch' && command.type === 'patch') {
        for (const key of Object.keys(command.fields)) merge.command.fields[key].value = command.fields[key].value;
        ids.push(merge.id);
      } else {
        const id = crypto.randomUUID();
        this.pending.push({ id, command, dependencies, baseValues });
        ids.push(id);
      }
      this.project(false);
    }
    this.project();
    // Await the coalesced checkpoint: it resolves once the current journal
    // write settles (further saves are batched into it), so a burst of
    // enqueues waits together on one write instead of one write per enqueue.
    // This keeps the batch window wide enough to merge the burst into a few
    // submits while still guaranteeing the draft is persisted before the tab
    // can close (an offline draft must survive a closed tab).
    await this.checkpoint();
    this.schedulePump();
    return ids;
  }
  private commandsFor(m: RecordValue): RoomCommand[] {
    // Explicit UI/CLI intent conversion. Full snapshots never call this function.
    if (m.commands) return structuredClone(m.commands).map((c: RoomCommand) => remapCommand(c, this.aliases));
    if (m.type === 'layer:create')
      return [{ type: 'create', kind: 'layer', localId: m.layer.id, data: structuredClone(m.layer) }];
    const kind: EntityKind = m.type.startsWith('layer:') ? 'layer' : 'feature';
    const id = this.resolve(m.layerId || m.featureId || m.layer?.id || m.feature?.id || '');
    if (m.type.endsWith(':delete')) return [{ type: 'delete', kind, id }];
    if (m.type.endsWith(':move')) {
      const row = this.view.get(kind, id);
      return [
        {
          type: 'move',
          kind,
          id,
          beforeId: m.beforeId ? this.resolve(m.beforeId) : null,
          expectedVersion: fieldVersion(row, 'position'),
        },
      ];
    }
    if (m.type.endsWith(':reorder')) {
      const ordered = m.updates
        .slice()
        .sort((a: RecordValue, b: RecordValue) => a.sortKey.localeCompare(b.sortKey))
        .map((x: RecordValue) => this.resolve(x.layerId || x.featureId));
      const commands: RoomCommand[] = [];
      const projected = new SyncView();
      projected.replace(this.view.getLayers(), this.view.getAnnotationFeatures());
      for (let i = ordered.length - 1; i >= 0; i--) {
        const row = projected.get(kind, ordered[i]);
        if (!row) continue;
        const rows = kind === 'layer' ? projected.getLayers() : projected.getAnnotationFeatures(row.layerId);
        const beforeId = ordered[i + 1] || null;
        if (
          rows[rows.findIndex((r) => r.id === row.id) + 1]?.id === beforeId ||
          (!beforeId && rows.at(-1)?.id === row.id)
        )
          continue;
        const c: RoomCommand = {
          type: 'move',
          kind,
          id: row.id,
          beforeId,
          expectedVersion: fieldVersion(this.view.get(kind, row.id), 'position'),
        };
        commands.push(c);
        projected.project(c);
      }
      return commands;
    }
    const old = m.baseline || this.view.get(kind, id);
    if (
      kind === 'feature' &&
      !old &&
      m.isCreate !== false &&
      !this.aliases[m.feature.id] &&
      !Object.values(this.aliases).includes(id)
    )
      return [
        {
          type: 'create',
          kind,
          localId: m.feature.id,
          data: { ...structuredClone(m.feature), layerId: this.resolve(m.feature.layerId) },
        },
      ];
    if (!old)
      return [
        {
          type: 'patch',
          kind,
          id,
          fields:
            kind === 'layer'
              ? { name: { expectedVersion: 0, value: m.patch?.name || m.layer?.name || '' } }
              : { label: { expectedVersion: 0, value: m.feature?.payload?.label || '' } },
        },
      ];
    let next: RecordValue;
    if (kind === 'feature') next = { ...m.feature, id, layerId: this.resolve(m.feature.layerId) };
    else if (m.type === 'layer:replace') next = m.layer;
    else {
      next = structuredClone(old);
      for (const key of ['name', 'visible']) if (m.patch?.[key] !== undefined) next[key] = m.patch[key];
      if (m.patch?.payload && old.kind === 'file')
        next.payload = {
          ...old.payload,
          ...m.patch.payload,
          style: { ...old.payload.style, ...m.patch.payload.style },
        };
    }
    const fields: Record<string, { expectedVersion: number; value: unknown }> = {};
    const before = readFields(kind, old);
    const after = readFields(kind, next);
    for (const key of Object.keys(after))
      if (!equalValue(after[key], before[key]))
        fields[key] = { expectedVersion: fieldVersion(old, key), value: after[key] };
    return Object.keys(fields).length ? [{ type: 'patch', kind, id, fields }] : [];
  }
  connect(writable: boolean) {
    this.connected = true;
    this.writable = writable;
    this.ready = false;
    this.sent = false;
    this.requestPending = false;
    this.uploaded.clear();
    this.uploading.clear();
    this.generation++;
    void this.loaded.then(() => this.requestSnapshot(true));
  }
  disconnect() {
    this.connected = false;
    this.ready = false;
    this.sent = false;
    this.requestPending = false;
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.pumpTimer);
    this.uploading.clear();
    this.options.changed?.();
  }
  dispose() {
    this.disposed = true;
    this.disconnect();
  }
  async drain() {
    await this.loaded;
    await this.receiving;
    await this.saving;
  }
  setWritable(value: boolean) {
    this.writable = value;
    if (value && this.ready && !this.clientId) this.requestSnapshot(true);
    else this.schedulePump();
  }
  requestSnapshot(open = false) {
    if (!this.connected || this.disposed || this.requestPending || this.storageError) return;
    this.ready = false;
    this.requestPending = true;
    const message = {
      type: open ? 'sync:open' : 'sync:request',
      protocol: 2,
      epoch: this.epoch,
      clientId: this.clientId,
    };
    if (!this.options.send(message)) this.requestPending = false;
    else this.armRecovery();
  }
  private armRecovery() {
    clearTimeout(this.timer);
    const delay = Math.min(30_000, 1000 * 2 ** this.retryAttempt++) * (0.75 + Math.random() * 0.5);
    this.timer = setTimeout(() => {
      this.requestPending = false;
      this.sent = false;
      this.requestSnapshot(true);
    }, delay);
  }
  receive(message: ServerMessage): Promise<void> {
    const generation = this.generation;
    const task = this.receiving.then(() => (generation === this.generation ? this.process(message) : undefined));
    this.receiving = task.catch(() => {
      this.storageError = 'Could not apply shared state. Your local drafts are saved.';
      this.options.changed?.();
    });
    return task;
  }
  private async process(m: ServerMessage) {
    await this.loaded;
    if (this.disposed) return;
    if (m.type === 'sync:error') {
      if (m.reason === 'content_needed') {
        if (m.contentHash) {
          this.uploaded.delete(m.contentHash);
          this.uploading.delete(m.contentHash);
        }
        this.sent = false;
        this.schedulePump();
        return;
      }
      clearTimeout(this.timer);
      this.requestPending = false;
      this.sent = false;
      if (m.reason === 'client_expired' || m.reason === 'client_forbidden') {
        this.generation++;
        if (this.inFlight) this.rejectDrafts(this.inFlight.entryIds, 'result_unknown');
        this.inFlight = null;
        this.clientId = null;
        this.lastProcessedSeq = 0;
        this.recoveringExpired = true;
        this.project();
        await this.checkpoint();
        this.requestSnapshot(true);
        return;
      }
      if (m.reason === 'sequence-gap' || m.reason === 'already_processed') {
        this.requestSnapshot();
        return;
      }
      this.ready = false;
      this.storageError = `Sync paused: ${m.reason}. Your edits remain on this device.`;
      this.options.changed?.();
      return;
    }
    if (m.type === 'sync:snapshot') {
      clearTimeout(this.timer);
      this.requestPending = false;
      this.sent = false;
      this.uploading.clear();
      if (this.epoch && m.epoch !== this.epoch && this.inFlight) {
        this.rejectDrafts(this.inFlight.entryIds, 'result_unknown');
        this.inFlight = null;
        this.recoveringExpired = true;
      }
      this.epoch = m.epoch;
      this.clientId = m.clientId;
      if (this.inFlight) {
        const seq = this.inFlight.operation.seq;
        if (seq === m.lastProcessedSeq && m.lastResult) this.settle(m.lastResult);
        else if (seq !== m.lastProcessedSeq + 1) {
          this.rejectDrafts(this.inFlight.entryIds, 'result_unknown');
          this.inFlight = null;
        }
      }
      this.lastProcessedSeq = m.lastProcessedSeq;
      this.commitVersion = m.commitVersion;
      this.canonical.replace(m.layers, m.features);
      if (this.recoveringExpired) {
        this.rebaseExpired();
        this.recoveringExpired = false;
      }
      this.ready = true;
    } else if (m.type === 'sync:commit') {
      if (m.epoch !== this.epoch || m.commitVersion > this.commitVersion + 1 || !this.ready) {
        this.requestSnapshot();
        return;
      }
      if (m.commitVersion <= this.commitVersion) return;
      this.canonical.delta(m.delta);
      this.commitVersion = m.commitVersion;
    } else {
      if (!this.inFlight || m.clientId !== this.clientId || m.result.seq !== this.inFlight.operation.seq) return;
      clearTimeout(this.timer);
      this.sent = false;
      this.settle(m.result);
      if (
        m.epoch !== this.epoch ||
        m.result.commitVersion > this.commitVersion + 1 ||
        (m.result.commitVersion > this.commitVersion && !m.delta)
      ) {
        this.project();
        await this.checkpoint();
        this.requestSnapshot();
        return;
      }
      if (m.delta && m.result.commitVersion > this.commitVersion) {
        this.canonical.delta(m.delta);
        this.commitVersion = m.result.commitVersion;
      }
      if (m.current?.entity) this.canonical.set(m.current.kind, m.current.entity);
    }
    if (!this.inFlight) this.retryAttempt = 0;
    this.gcFiles();
    this.project();
    await this.checkpoint();
    for (const event of this.settledEvents.splice(0)) this.options.settled?.(event.result, event.drafts);
    this.schedulePump();
  }
  private settle(result: BatchResult) {
    if (!this.inFlight) return;
    const batchIds = new Set(this.inFlight.entryIds);
    const drafts = this.pending.filter((d) => batchIds.has(d.id));
    this.inFlight = null;
    this.lastProcessedSeq = result.seq;
    this.lastOutcome = result;
    if (result.status === 'accepted') {
      this.pending = this.pending.filter((draft) => !batchIds.has(draft.id));
      Object.assign(this.aliases, result.ids);
      for (const draft of this.pending) {
        const resolved = draft.dependencies.some((id) => batchIds.has(id));
        draft.command = remapCommand(draft.command, result.ids);
        if (resolved && draft.command.type !== 'create') {
          const targetKey = entityKey(draft.command.kind, draft.command.id);
          const versions = result.versions[targetKey] || {};
          if (draft.command.type === 'patch')
            for (const [key, edit] of Object.entries(draft.command.fields))
              if (
                versions[key] !== undefined &&
                drafts.some(
                  (d) =>
                    draft.dependencies.includes(d.id) &&
                    (commandKeys(remapCommand(d.command, result.ids)).includes(`${targetKey}:${key}`) ||
                      (d.command.type === 'create' &&
                        result.ids[d.command.localId] === (draft.command as { id: string }).id)),
                )
              )
                edit.expectedVersion = versions[key];
          if (draft.command.type === 'move' && versions.position !== undefined)
            draft.command.expectedVersion = versions.position;
        }
        draft.dependencies = draft.dependencies.filter((id) => !batchIds.has(id));
      }
      this.options.remap?.(result.ids);
    } else {
      const failed =
        result.commandIndex === undefined ? drafts.map((d) => d.id) : [drafts[result.commandIndex]?.id].filter(Boolean);
      this.rejectDrafts(failed, result.reason || 'conflict');
    }
    this.settledEvents.push({ result, drafts });
  }
  private rejectDrafts(ids: string[], reason: string) {
    const rejected = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const draft of this.pending)
        if (!rejected.has(draft.id) && draft.dependencies.some((id) => rejected.has(id))) {
          rejected.add(draft.id);
          changed = true;
        }
    }
    for (const draft of this.pending)
      if (rejected.has(draft.id))
        this.conflicts.push({ ...draft, reason: ids.includes(draft.id) ? reason : 'dependency-conflict' });
    this.pending = this.pending.filter((d) => !rejected.has(d.id));
  }
  private rebaseExpired() {
    for (const d of [...this.pending]) {
      if (d.command.type === 'create' || d.command.type === 'delete') continue;
      const row = this.canonical.get(d.command.kind, d.command.id);
      if (!row) {
        this.rejectDrafts([d.id], 'target_missing');
        continue;
      }
      if (d.command.type === 'move') {
        this.rejectDrafts([d.id], 'position-needs-review');
        continue;
      }
      const fields = readFields(d.command.kind, row);
      for (const [field, edit] of Object.entries(d.command.fields)) {
        if (!equalValue(fields[field], d.baseValues[field]) && !equalValue(fields[field], edit.value)) {
          this.rejectDrafts([d.id], 'revision-conflict');
          break;
        }
        edit.expectedVersion = fieldVersion(row, field);
      }
    }
  }
  async discardConflicts() {
    this.conflicts = [];
    this.gcFiles();
    await this.checkpoint();
    this.options.changed?.();
  }
  async resolveConflict(id: string, useLocal: boolean) {
    const conflict = this.conflicts.find((d) => d.id === id);
    if (!conflict) return;
    const command = structuredClone(conflict.command);
    if (useLocal && command.type !== 'create' && command.type !== 'delete') {
      const row = this.canonical.get(command.kind, command.id);
      if (!row) return;
      if (command.type === 'patch')
        for (const [field, edit] of Object.entries(command.fields)) edit.expectedVersion = fieldVersion(row, field);
      else command.expectedVersion = fieldVersion(row, 'position');
    }
    this.conflicts = this.conflicts.filter((d) => d.id !== id);
    if (useLocal) await this.enqueue({ commands: [command] });
    else await this.checkpoint();
    this.options.changed?.();
  }
  contentStored(hash: string) {
    this.uploading.delete(hash);
    this.uploaded.add(hash);
    clearTimeout(this.timer);
    this.schedulePump();
  }
  private gcFiles() {
    const needed = new Set([...this.pending, ...this.conflicts].map((d) => commandFileHash(d.command)).filter(Boolean));
    for (const c of this.inFlight?.operation.commands || []) for (const hash of this.hashes(c)) needed.add(hash);
    for (const hash of Object.keys(this.files)) if (!needed.has(hash)) delete this.files[hash];
  }
  private hashes(c: RoomCommand): string[] {
    const hashes: string[] = [];
    const file = commandFileHash(c);
    if (file) hashes.push(file);
    if (c.type === 'create' && c.kind === 'feature' && c.data.payload?.$content) hashes.push(c.data.payload.$content);
    if (c.type === 'patch' && (c.fields.geometry?.value as RecordValue)?.$content)
      hashes.push((c.fields.geometry.value as RecordValue).$content);
    return hashes;
  }
  private schedulePump() {
    if (this.disposed) return;
    // Arm the pump at most once per batch window so a sustained stream of
    // enqueues cannot postpone the flush indefinitely. As soon as a
    // significant number of drafts is pending, flush immediately so large
    // bursts stay batched even when enqueues are slow (e.g. a throttled CI
    // browser) instead of degrading into one tiny submit each.
    if (this.pending.length >= MAX_BATCH_COMMANDS) {
      if (this.pumpTimer) {
        clearTimeout(this.pumpTimer);
        this.pumpTimer = undefined;
      }
      void this.flush();
      return;
    }
    if (this.pumpTimer) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = undefined;
      void this.flush();
    }, this.options.batchDelay ?? 30);
  }
  private async prepare(command: RoomCommand): Promise<RoomCommand> {
    const c = structuredClone(command);
    if (JSON.stringify(c).length < 100_000) return c;
    const value =
      c.type === 'create' && c.kind === 'feature'
        ? c.data.payload
        : c.type === 'patch'
          ? c.fields.geometry?.value
          : null;
    if (!value) return c;
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('edit-too-large');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    this.files[hash] = new Blob([bytes.buffer]);
    if (c.type === 'create') c.data.payload = { $content: hash };
    else if (c.type === 'patch') c.fields.geometry.value = { $content: hash };
    return c;
  }
  async flush() {
    await this.loaded;
    // Do not await an in-flight journal save here: pending drafts are already
    // in memory and the journal is re-checkpointed once the batch is built below,
    // so blocking on a slow save would only add latency to every submit round.
    if (
      this.pumping ||
      this.disposed ||
      !this.connected ||
      !this.ready ||
      !this.writable ||
      !this.clientId ||
      this.sent ||
      this.storageError
    )
      return;
    this.pumping = true;
    const generation = this.generation;
    try {
      if (!this.inFlight) {
        const commands: RoomCommand[] = [];
        const entryIds: string[] = [];
        let resultBytes = 512;
        const candidates = this.pending.slice(0, MAX_BATCH_COMMANDS);
        this.preparingIds = new Set(candidates.map((d) => d.id));
        for (const draft of candidates) {
          if (!this.pending.some((entry) => entry.id === draft.id)) continue;
          const cost =
            draft.command.type === 'create'
              ? 256 + Object.keys(readFields(draft.command.kind, draft.command.data)).length * 48
              : draft.command.type === 'patch'
                ? 160 + Object.keys(draft.command.fields).length * 48
                : draft.command.type === 'move'
                  ? 180
                  : 0;
          if (resultBytes + cost > MAX_RESULT_BYTES) break;
          resultBytes += cost;
          let command: RoomCommand;
          try {
            command = await this.prepare(draft.command);
          } catch {
            this.rejectDrafts([draft.id], 'edit-too-large');
            continue;
          }
          if (new TextEncoder().encode(JSON.stringify([...commands, command])).byteLength > MAX_BATCH_BYTES - 1024) {
            if (!commands.length) this.rejectDrafts([draft.id], 'edit-too-large');
            break;
          }
          commands.push(command);
          entryIds.push(draft.id);
        }
        if (!commands.length) {
          this.project();
          await this.checkpoint();
          return;
        }
        this.inFlight = {
          operation: {
            type: 'sync:submit',
            protocol: 2,
            epoch: this.epoch,
            clientId: this.clientId,
            seq: this.lastProcessedSeq + 1,
            commands,
          },
          entryIds,
        };
        await this.checkpoint();
      }
      if (generation !== this.generation || !this.connected || !this.ready || this.storageError || !this.inFlight)
        return;
      for (const c of this.inFlight.operation.commands)
        for (const hash of this.hashes(c)) {
          if (this.uploaded.has(hash)) continue;
          if (this.uploading.has(hash)) return;
          const blob = this.files[hash];
          if (!blob) {
            this.storageError = 'File content is unavailable. Export your drafts before closing this tab.';
            this.options.changed?.();
            return;
          }
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (generation !== this.generation || !this.connected) return;
          this.uploading.add(hash);
          if (!this.options.send(encodeFileContentMessage(hash, bytes))) this.uploading.delete(hash);
          else this.armRecovery();
          return;
        }
      this.sent = true;
      if (!this.options.send(this.inFlight.operation)) this.sent = false;
      else this.armRecovery();
    } finally {
      this.preparingIds.clear();
      this.pumping = false;
    }
  }
}
