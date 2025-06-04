// ensdomains-content-hash.d.ts
declare module '@ensdomains/content-hash' {
  export function decode (hash: string): string
  export function encode (contentType: string, text: string): string
  export function getCodec (value: string): string
}
