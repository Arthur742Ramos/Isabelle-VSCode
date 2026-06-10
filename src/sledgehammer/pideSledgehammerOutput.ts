// Forgiving parser and webview-safe renderer for the Isabelle XML-markup
// payload that Isabelle's `isabelle vscode_server` emits on the
// `PIDE/sledgehammer_output` LSP notification.
//
// Upstream produces the payload as
// `XML.string_of_body(Pretty.unbreakable(output.messages))` — see
// docs/sledgehammer_lsp_research.md for the full investigation. The
// content is NOT plain text and NOT arbitrary HTML: it is Isabelle's own
// XML-markup body. Naive HTML escaping plus `<pre>` will display angle
// brackets and lose typed-message styling; naive `innerHTML` will
// misinterpret elements such as `<error_message>...</error_message>`,
// `<sendback>...</sendback>`, and Pretty's `<block>`/`<break/>` framing.
//
// This module:
//   1. Tokenizes the payload into open/close/self-closing tags and text
//      runs, decoding standard XML entities.
//   2. Walks the token stream maintaining a frame stack to produce a
//      typed node tree where the only structurally meaningful kinds are
//      `error_message`, `warning_message`, `information_message`, and
//      `sendback`. Every other element (block, break, keyword, entity,
//      class, …) is transparent — its inner text continues to flow into
//      the surrounding frame.
//   3. Renders the tree to webview-safe HTML, always escaping text and
//      tagging segments with stable CSS class names that the consumer
//      (the Sledgehammer panel webview) can style.
//
// The parser is intentionally forgiving:
//   - Unterminated tags / messages flush as-is rather than throwing.
//   - Unmatched closing tags for known kinds are silently dropped.
//   - Sendback frames are leaves: any nested markup (including nested
//     sendback or message kinds) is flattened to their text content so
//     the sendback retains a single, click-to-insert proof string.
//   - `<break/>` self-closing tags are translated to a single space,
//     matching `Pretty.unbreakable` output.

export type PideOutputNodeKind =
  | "text"
  | "sendback"
  | "error"
  | "warning"
  | "information";

export interface PideTextNode {
  readonly kind: "text";
  readonly text: string;
}

export interface PideSendbackNode {
  readonly kind: "sendback";
  /**
   * The proof text inside the sendback element, with any nested markup
   * flattened to plain text. The text is NOT trimmed by the parser so
   * upstream whitespace from Pretty formatting is preserved verbatim;
   * callers that want a sanitized proof string (for example, to send
   * back to `PIDE/sledgehammer_sendback`) should trim it themselves.
   */
  readonly text: string;
}

export interface PideMessageNode {
  readonly kind: "error" | "warning" | "information";
  readonly children: readonly PideOutputNode[];
}

export type PideOutputNode = PideTextNode | PideSendbackNode | PideMessageNode;

/**
 * Parse an Isabelle XML-markup string from `PIDE/sledgehammer_output`
 * into a flat list of top-level nodes. Returns an empty list for an
 * empty or undefined input.
 */
export function parsePideSledgehammerOutput(raw: string): readonly PideOutputNode[] {
  if (!raw) {
    return [];
  }
  return new Parser(raw).run();
}

/**
 * Walk a parsed node tree and return every sendback's text in document
 * order, trimmed. Used by the Sledgehammer panel to enumerate
 * click-to-insert proof candidates without re-traversing the tree.
 */
export function collectSendbackTexts(
  nodes: readonly PideOutputNode[]
): readonly string[] {
  const out: string[] = [];
  const walk = (node: PideOutputNode): void => {
    if (node.kind === "sendback") {
      const trimmed = node.text.trim();
      if (trimmed.length > 0) {
        out.push(trimmed);
      }
    } else if (node.kind !== "text") {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  for (const node of nodes) {
    walk(node);
  }
  return out;
}

/**
 * Render a parsed node tree to webview-safe HTML.
 *
 * Returns an empty string for an empty input. Every text segment is
 * HTML-escaped. The renderer does not attach interactivity — sendback
 * spans are emitted with the `pide-sledgehammer-sendback` class plus a
 * `data-pide-sendback` attribute carrying the (escaped) proof text so
 * the consuming webview can wire click handlers without re-parsing.
 */
export function renderPideOutputHtml(
  nodes: readonly PideOutputNode[]
): string {
  if (nodes.length === 0) {
    return "";
  }
  return nodes.map(renderNode).join("");
}

function renderNode(node: PideOutputNode): string {
  switch (node.kind) {
    case "text":
      return `<span class="pide-sledgehammer-text">${escapeHtml(node.text)}</span>`;
    case "sendback": {
      const escaped = escapeHtml(node.text);
      return `<code class="pide-sledgehammer-sendback" data-pide-sendback="${escaped}">${escaped}</code>`;
    }
    case "error":
    case "warning":
    case "information":
      return `<div class="pide-sledgehammer-message pide-sledgehammer-${node.kind}">${node.children
        .map(renderNode)
        .join("")}</div>`;
  }
}

// --------------------------------------------------------------- internals

type KnownTag =
  | "error_message"
  | "warning_message"
  | "information_message"
  | "sendback";

const KNOWN_TAGS: Readonly<Record<string, KnownTag>> = {
  error_message: "error_message",
  warning_message: "warning_message",
  information_message: "information_message",
  sendback: "sendback"
};

const MESSAGE_KIND: Readonly<Record<KnownTag, "error" | "warning" | "information" | "sendback">> = {
  error_message: "error",
  warning_message: "warning",
  information_message: "information",
  sendback: "sendback"
};

interface RootFrame {
  readonly kind: "root";
  readonly children: PideOutputNode[];
  buf: string;
}

interface MessageFrame {
  readonly kind: "message";
  readonly nodeKind: "error" | "warning" | "information";
  readonly children: PideOutputNode[];
  buf: string;
}

interface SendbackFrame {
  readonly kind: "sendback";
  buf: string;
}

type Frame = RootFrame | MessageFrame | SendbackFrame;

class Parser {
  private readonly stack: Frame[];

  public constructor(private readonly raw: string) {
    this.stack = [{ kind: "root", children: [], buf: "" }];
  }

  public run(): readonly PideOutputNode[] {
    const raw = this.raw;
    let i = 0;
    while (i < raw.length) {
      if (raw[i] !== "<") {
        const next = raw.indexOf("<", i);
        const end = next < 0 ? raw.length : next;
        this.appendText(decodeXmlEntities(raw.slice(i, end)));
        i = end;
        continue;
      }

      const tagEnd = findTagEnd(raw, i);
      if (tagEnd < 0) {
        this.appendText(decodeXmlEntities(raw.slice(i)));
        break;
      }

      const tagBody = raw.slice(i + 1, tagEnd);
      i = tagEnd + 1;

      if (tagBody.length === 0) {
        this.appendText("<>");
        continue;
      }

      if (tagBody[0] === "/") {
        this.handleClose(tagBody.slice(1));
        continue;
      }

      this.handleOpen(tagBody);
    }

    // Flush unterminated frames so partial input still renders. Pops in
    // inner-to-outer order, accumulating each frame's children into the
    // parent so the top-level list is well-formed.
    while (this.stack.length > 1) {
      const child = this.stack.pop() as Frame;
      this.closeIntoParent(child);
    }
    this.flushPending(this.stack[0]);

    return (this.stack[0] as RootFrame).children;
  }

  private appendText(text: string): void {
    if (text.length === 0) {
      return;
    }
    this.top().buf += text;
  }

  private top(): Frame {
    return this.stack[this.stack.length - 1];
  }

  private handleOpen(tagBody: string): void {
    const isSelfClose = tagBody.endsWith("/");
    const inner = isSelfClose ? tagBody.slice(0, -1).trim() : tagBody.trim();
    const nameMatch = /^([A-Za-z_][\w-]*)/.exec(inner);
    if (!nameMatch) {
      // Malformed: keep the original text so the user can see what came
      // through the wire instead of silently dropping it.
      this.appendText(`<${tagBody}>`);
      return;
    }
    const name = nameMatch[1];

    if (isSelfClose) {
      // <break/> is a `Pretty.unbreakable` soft space; everything else
      // self-closing is structural and contributes no visible text.
      if (name === "break") {
        this.appendText(" ");
      }
      return;
    }

    const known = KNOWN_TAGS[name];
    if (!known) {
      // Unknown opening tags are transparent — their text content
      // continues to flow into the surrounding frame and their closing
      // tag is dropped by the close path.
      return;
    }

    if (this.top().kind === "sendback") {
      // Sendback is a leaf: nested known markup is intentionally
      // flattened. Text between the swallowed open/close still flows
      // into the sendback's buf.
      return;
    }

    this.flushPending(this.top());
    if (known === "sendback") {
      this.stack.push({ kind: "sendback", buf: "" });
    } else {
      this.stack.push({
        kind: "message",
        nodeKind: MESSAGE_KIND[known] as "error" | "warning" | "information",
        children: [],
        buf: ""
      });
    }
  }

  private handleClose(rawName: string): void {
    const name = rawName.trim().split(/\s/)[0] ?? "";
    const known = KNOWN_TAGS[name];
    if (!known) {
      return;
    }

    const idx = this.findMatchingOpen(known);
    if (idx <= 0) {
      // No matching open (or only root would match): drop silently. This
      // happens when nested known markup was flattened inside a sendback
      // or when input is malformed.
      return;
    }

    // Pop any frames stacked above the target, flattening them into
    // their immediate parent.
    while (this.stack.length - 1 > idx) {
      const intermediate = this.stack.pop() as Frame;
      this.closeIntoParent(intermediate);
    }

    const matched = this.stack.pop() as Frame;
    this.closeIntoParent(matched);
  }

  private findMatchingOpen(tag: KnownTag): number {
    if (tag === "sendback") {
      for (let i = this.stack.length - 1; i >= 0; i--) {
        if (this.stack[i].kind === "sendback") {
          return i;
        }
      }
      return -1;
    }
    const expected = MESSAGE_KIND[tag];
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      if (frame.kind === "message" && frame.nodeKind === expected) {
        return i;
      }
    }
    return -1;
  }

  private closeIntoParent(child: Frame): void {
    const parent = this.top();
    const node = buildNode(child);
    if (parent.kind === "sendback") {
      // Flatten the child into the sendback's text content. This both
      // matches the leaf invariant and preserves user-visible text from
      // accidentally-nested markup.
      parent.buf += extractText(node);
      return;
    }
    this.flushPending(parent);
    parent.children.push(node);
  }

  private flushPending(frame: Frame): void {
    if (frame.kind === "sendback") {
      return;
    }
    if (frame.buf.length > 0) {
      frame.children.push({ kind: "text", text: frame.buf });
      frame.buf = "";
    }
  }
}

function buildNode(frame: Frame): PideOutputNode {
  if (frame.kind === "sendback") {
    return { kind: "sendback", text: frame.buf };
  }
  if (frame.kind === "message") {
    const children = frame.children.slice();
    if (frame.buf.length > 0) {
      children.push({ kind: "text", text: frame.buf });
    }
    return { kind: frame.nodeKind, children };
  }
  // Should never happen: root never closes into a parent.
  return { kind: "text", text: "" };
}

function extractText(node: PideOutputNode): string {
  if (node.kind === "text" || node.kind === "sendback") {
    return node.text;
  }
  return node.children.map(extractText).join("");
}

function findTagEnd(input: string, openIdx: number): number {
  let j = openIdx + 1;
  let inQuote: '"' | "'" | undefined;
  while (j < input.length) {
    const c = input[j];
    if (inQuote !== undefined) {
      if (c === inQuote) {
        inQuote = undefined;
      }
    } else if (c === '"' || c === "'") {
      inQuote = c;
    } else if (c === ">") {
      return j;
    }
    j++;
  }
  return -1;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'"
};

function decodeXmlEntities(input: string): string {
  return input.replace(
    /&(amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);/g,
    (match, ref: string) => {
      if (ref.startsWith("#x")) {
        return fromCodePointOrSelf(Number.parseInt(ref.slice(2), 16), match);
      }
      if (ref.startsWith("#")) {
        return fromCodePointOrSelf(Number.parseInt(ref.slice(1), 10), match);
      }
      return NAMED_ENTITIES[ref] ?? match;
    }
  );
}

/**
 * Convert a numeric character reference to its character, or return the
 * original `fallback` text when the value is not a legal Unicode code point.
 * `String.fromCodePoint` throws a `RangeError` for anything outside
 * `0 … 0x10FFFF`, so an out-of-range or malformed entity (e.g. `&#x110000;`)
 * must be rejected here rather than be allowed to crash the whole parse — and
 * with it the proof-state / Sledgehammer panel render.
 */
function fromCodePointOrSelf(codePoint: number, fallback: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return fallback;
  }
  return String.fromCodePoint(codePoint);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
