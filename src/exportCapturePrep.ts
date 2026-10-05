/**
 * DOM prep + error plumbing shared by the html-to-image exporters (PNG, SVG, PDF).
 *
 * html-to-image serializes the cloned viewport to XML and loads it as an
 * SVG <img>. Two ways that pipeline fails without an Error:
 *
 * - A text node or attribute holding an XML 1.0-illegal character (vertical
 *   tab / form feed from an Excel paste, other C0 controls) makes the
 *   serialized SVG ill-formed. The SVG <img> then fires `error`, and
 *   html-to-image rejects with the raw `Event`. That breaks PNG and PDF in
 *   every browser and makes SVG export ship an unparseable file.
 * - Any cloned <img>/<image> that fails to load also rejects with the raw Event.
 *
 * Lone UTF-16 surrogates are scrubbed too: encodeURIComponent throws on them.
 */

// XML 1.0 Char excludes C0 controls other than tab/LF/CR, U+FFFE/U+FFFF, and
// unpaired surrogates.
const XML_ILLEGAL =
  // eslint-disable-next-line no-control-regex -- matching control chars is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function scrubXmlIllegalChars(text: string): string {
  // Controls become spaces so "Line1<VT>Line2" stays readable as two words.
  return text.replace(XML_ILLEGAL, " ");
}

/**
 * Temporarily replace XML-illegal characters in every text node and attribute
 * under `root`. Returns a restore function. A node React rewrote mid-capture is
 * left alone on restore.
 */
export function scrubXmlIllegalDom(root: HTMLElement): () => void {
  const restores: Array<() => void> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const original = n.nodeValue ?? "";
    const scrubbed = scrubXmlIllegalChars(original);
    if (scrubbed !== original) {
      const node = n;
      node.nodeValue = scrubbed;
      restores.push(() => {
        if (node.nodeValue === scrubbed) node.nodeValue = original;
      });
    }
  }
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const attr of Array.from(el.attributes)) {
      const original = attr.value;
      const scrubbed = scrubXmlIllegalChars(original);
      if (scrubbed !== original) {
        el.setAttribute(attr.name, scrubbed);
        restores.push(() => {
          if (el.getAttribute(attr.name) === scrubbed) el.setAttribute(attr.name, original);
        });
      }
    }
  }
  return () => restores.forEach((r) => r());
}

/** Human-readable reason for an export failure, including non-Error rejections. */
export function describeExportError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof Event !== "undefined" && err instanceof Event) {
    return "the browser couldn't render the schematic as an image";
  }
  if (typeof err === "string" && err) return err;
  return "unexpected error";
}
