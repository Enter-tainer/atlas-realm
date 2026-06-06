export const COLLABORATION_ACCESS_EVENT = 'collaboration:accesschange';

export type CollaborationAccessDetail = {
  canView: boolean;
  canEdit: boolean;
  canManage: boolean;
  role: 'none' | 'view' | 'edit' | 'manage';
};

export function collaborationCanEdit(container: HTMLElement | undefined | null) {
  return container?.dataset.collaborationCanEdit !== 'false';
}
