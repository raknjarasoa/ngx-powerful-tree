import { NgxTreeItem, NgxTreeNode } from './ngx-tree.types';

/**
 * Inverse of {@link flattenNodes}: rebuild the nested {@link NgxTreeNode}
 * tree from the store's flat `{ items, rootIds }` representation. Useful
 * when feeding a secondary tree (e.g. a relocation picker) from a live
 * tree's store state.
 */
export function expandItems<T>(
  items: Record<string, NgxTreeItem<T>>,
  rootIds: string[]
): NgxTreeNode<T>[] {
  const visit = (id: string): NgxTreeNode<T> | null => {
    const item = items[id];
    if (!item) return null;
    const children = item.children?.map(visit).filter((c): c is NgxTreeNode<T> => c !== null);
    return {
      id: item.id,
      name: item.name,
      isFolder: item.isFolder,
      children: children?.length ? children : undefined,
      data: item.data,
      locked: item.locked,
      icon: item.icon,
    };
  };
  return rootIds.map(visit).filter((n): n is NgxTreeNode<T> => n !== null);
}

/**
 * Convert the public nested {@link NgxTreeNode} shape into the flat
 * `{ items, rootIds }` representation used internally by the store. Throws
 * on duplicate ids — silent overwrites would corrupt children references.
 */
export function flattenNodes<T>(nodes: NgxTreeNode<T>[]): {
  items: Record<string, NgxTreeItem<T>>;
  rootIds: string[];
} {
  const items: Record<string, NgxTreeItem<T>> = {};
  const rootIds: string[] = [];

  const visit = (node: NgxTreeNode<T>): void => {
    if (items[node.id]) {
      throw new Error(`ngx-powerful-tree: duplicate node id "${node.id}"`);
    }
    items[node.id] = {
      id: node.id,
      name: node.name,
      isFolder: node.isFolder,
      children: node.children?.map((c) => c.id),
      data: node.data,
      locked: node.locked,
      icon: node.icon,
    };
    if (node.children) {
      for (const child of node.children) visit(child);
    }
  };

  for (const node of nodes) {
    rootIds.push(node.id);
    visit(node);
  }

  return { items, rootIds };
}
