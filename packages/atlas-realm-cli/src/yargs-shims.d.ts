declare module 'yargs' {
  const yargs: (argv?: readonly string[]) => any;
  export default yargs;
}

declare module 'yargs/helpers' {
  export function hideBin(argv: string[]): string[];
}
