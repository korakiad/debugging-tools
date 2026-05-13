export function assertNever(x: never, where: string): never {
    throw new Error(`assertNever at ${where}: ${JSON.stringify(x)}`);
}
