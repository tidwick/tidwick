// jsdom ships no types; this is the part of it that src/theme/theme.dom.test.ts uses.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options: { url: string; runScripts: 'outside-only' });
    readonly window: {
      eval(code: string): unknown;
      readonly Event: new (type: string) => Event;
      readonly localStorage: Storage;
      readonly document: Document;
    };
  }
}
