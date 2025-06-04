declare module 'content-hash' {
  export function encode (contentType: string, content: string): string
  export function decode (hash: string): string
}
