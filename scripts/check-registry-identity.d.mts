export interface RegistryIdentity {
  readonly name: string;
  readonly publisher: string;
}

export function manifestIdentityFailures(manifest: unknown, expected: RegistryIdentity): string[];

export function marketplaceIdentityFailures(entries: unknown, expected: RegistryIdentity): string[];

export function openVsxIdentityFailures(metadata: unknown, expected: RegistryIdentity): string[];
