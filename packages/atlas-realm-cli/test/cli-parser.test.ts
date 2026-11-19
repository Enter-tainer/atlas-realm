import { describe, expect, it } from 'vitest';
import { FEATURE_TYPES } from '../src/commands.js';
import { normalizeAnnotationCommand } from '../src/cli.js';

/**
 * `annotations add weather` used to be read as "add a point with the id
 * `weather`", because the parser kept its own feature-type allowlist that the
 * weather annotation never made it into. These tests pin the parser to the
 * shared list so a new feature type cannot drift out of it again.
 */
describe('annotation command feature types', () => {
  it('parses weather as a feature type, not as an id', () => {
    const command = normalizeAnnotationCommand('add', ['weather'], {});

    expect(command).toMatchObject({
      subject: 'annotations',
      action: 'add',
      featureType: 'weather',
      type: 'weather',
    });
    expect(command.id).toBeUndefined();
  });

  it('keeps reading a later positional as the id', () => {
    const command = normalizeAnnotationCommand('add', ['weather', 'shanghai-weather'], {});

    expect(command.featureType).toBe('weather');
    expect(command.id).toBe('shanghai-weather');
  });

  it('reads a feature type from the second positional on update', () => {
    const command = normalizeAnnotationCommand('update', ['shanghai-weather', 'weather'], {});

    expect(command).toMatchObject({ id: 'shanghai-weather', featureType: 'weather', type: 'weather' });
  });

  it('still treats an unknown leading token as an id', () => {
    const command = normalizeAnnotationCommand('add', ['my-own-id'], {});

    expect(command.featureType).toBeUndefined();
    expect(command.type).toBeUndefined();
    expect(command.id).toBe('my-own-id');
  });

  it('covers every type the command layer accepts', () => {
    for (const type of FEATURE_TYPES) {
      const command = normalizeAnnotationCommand('add', [type], {});
      expect(command.featureType).toBe(type);
      expect(command.type).toBe(type);
      expect(command.id).toBeUndefined();
    }
  });
});

describe('annotation batch target parsing', () => {
  it('merges positionals and the --ids option into one target list', () => {
    const command = normalizeAnnotationCommand('update', ['stop-a', 'stop-b'], { ids: 'stop-c, stop-d' });
    expect(command.ids).toEqual(['stop-a', 'stop-b', 'stop-c', 'stop-d']);
  });

  it('excludes a second positional feature type from the target list', () => {
    const command = normalizeAnnotationCommand('update', ['stop-a', 'weather'], {});
    expect(command.featureType).toBe('weather');
    expect(command.ids).toEqual(['stop-a']);
  });

  it('keeps reorder on the merged target list', () => {
    const command = normalizeAnnotationCommand('reorder', ['stop-b'], { ids: 'stop-a,stop-c' });
    expect(command.ids).toEqual(['stop-b', 'stop-a', 'stop-c']);
  });

  it('splits comma lists inside a repeated --ids flag', () => {
    // yargs keeps duplicate flags as an array when duplicate-arguments-array is
    // on, so each entry can still be a comma list.
    const command = normalizeAnnotationCommand('update', [], { ids: ['stop-a,stop-b', 'stop-c'] });
    expect(command.ids).toEqual(['stop-a', 'stop-b', 'stop-c']);
  });

  it('treats feature-type-looking ids as targets for reorder and delete', () => {
    const reorder = normalizeAnnotationCommand('reorder', ['route', 'seg-a', 'point'], {});
    expect(reorder.featureType).toBeUndefined();
    expect(reorder.ids).toEqual(['route', 'seg-a', 'point']);
    const deleted = normalizeAnnotationCommand('delete', ['route', 'text'], {});
    expect(deleted.featureType).toBeUndefined();
    expect(deleted.ids).toEqual(['route', 'text']);
  });
});
