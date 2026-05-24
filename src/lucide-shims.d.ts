type LucideIconAttrs = Record<string, string | number>;
type LucideIconNode = readonly [tag: string, attrs: LucideIconAttrs, children?: readonly LucideIconNode[]];
type LucideIcon = readonly LucideIconNode[];
type LucideSvgAttrs = Record<string, string | number | boolean>;

declare module 'lucide/dist/esm/createElement.mjs' {
  const createIconElement: (icon: LucideIcon, attrs?: LucideSvgAttrs) => SVGElement;
  export default createIconElement;
}

declare module 'lucide/dist/esm/icons/*.mjs' {
  const icon: LucideIcon;
  export default icon;
}
