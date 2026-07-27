"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useEditor, EditorContent, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import Link from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  Heading2,
  Quote,
  Undo,
  Redo,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

type ChannelInfo = {
  channelId: number
  title: string
  senderEmail: string | null
  senderName: string | null
  senderNamePersonal: string | null
  signature: string | null
}

type Props = {
  /** Trengo channel id for the email channel this thread belongs to. Drives
   *  the signature lookup (cached server-side for 5 min). */
  channelId: number | null
  /** Thread key - used to fetch the latest ticket subject for prefill so
   *  the composer behaves like a normal mail client (Re: <original> with
   *  inline edit). */
  threadKey: string
  /** Display "To" label - usually the contact's name + email from the
   *  thread header. Read-only on reply (Trengo binds it to the ticket). */
  toDisplay: string
  // Lifted state - owned by the parent so sendReply can read on submit.
  subject: string
  onSubjectChange: (s: string) => void
  cc: string[]
  onCcChange: (v: string[]) => void
  bcc: string[]
  onBccChange: (v: string[]) => void
  htmlBody: string
  onHtmlBodyChange: (html: string) => void
  /** Called with image files pasted into the editor. Wired up by the parent
   *  to the same upload pipeline that powers the 📎 button - pasting a
   *  screenshot lands as an attachment. Non-image clipboard contents fall
   *  through to TipTap's normal paste behavior. */
  onPasteFiles?: (files: File[]) => void
  /** Called with the channel's raw signature HTML once it loads (or null).
   *  The parent appends it to the outgoing email at send time so the sent
   *  mail carries the signature exactly as Trengo defined it, while the
   *  editor above stays message-only. */
  onSignatureChange?: (signature: string | null) => void
  /** Disabled while a send is in flight or uploads are running. */
  disabled?: boolean
}

/**
 * Email composer block - rich-text body via TipTap, From display pulled from
 * the channel info, To read-only, CC/BCC collapsed by default with chip
 * inputs, Subject prefilled empty (Trengo auto-fills `Re: <original>` when
 * not provided). Signature is fetched per channel and injected into the
 * editor on first open.
 *
 * Mirrors Trengo's web composer 1:1 so the AM gets parity. Phase 3 of the
 * composer parity work - see docs/trengo-api-audit.md for endpoint details.
 */
export function EmailComposer({
  channelId,
  threadKey,
  toDisplay,
  subject,
  onSubjectChange,
  cc,
  onCcChange,
  bcc,
  onBccChange,
  htmlBody,
  onHtmlBodyChange,
  onPasteFiles,
  onSignatureChange,
  disabled = false,
}: Props) {
  const [ccBccExpanded, setCcBccExpanded] = useState(cc.length > 0 || bcc.length > 0)

  // Fetch the channel's signature + sender info. Cached 5 min server-side
  // and idle-time on the client - opening the composer on a hot path
  // shouldn't show a flash of "no signature".
  const channelQuery = useQuery<ChannelInfo>({
    queryKey: ["email-channel", channelId],
    queryFn: () => fetch(`/api/inbox/email-channel?channelId=${channelId}`).then((r) => r.json()),
    enabled: !!channelId,
    staleTime: 5 * 60 * 1000,
  })

  const channel = channelQuery.data ?? null

  // Fetch the latest ticket subject so we can prefill `Re: <original>` -
  // matches normal mail client UX. AM can edit inline before sending.
  const subjectQuery = useQuery<{ subject: string | null }>({
    queryKey: ["thread-subject", threadKey],
    queryFn: () =>
      fetch(`/api/inbox/threads/${encodeURIComponent(threadKey)}/subject`).then((r) => r.json()),
    enabled: !!threadKey,
    staleTime: 5 * 60 * 1000,
  })

  // Prefill the subject input ONCE per thread (when the AM hasn't typed
  // anything yet). Don't stomp manual edits - once subject is non-empty we
  // back off forever for this mount.
  const subjectPrefilledRef = useRef(false)
  useEffect(() => {
    if (subjectPrefilledRef.current) return
    if (subject.trim().length > 0) {
      subjectPrefilledRef.current = true
      return
    }
    const fetched = subjectQuery.data?.subject
    if (!fetched) return
    onSubjectChange(buildReplySubject(fetched))
    subjectPrefilledRef.current = true
  }, [subject, subjectQuery.data?.subject, onSubjectChange])

  // TipTap editor instance. StarterKit gives bold/italic/strike/headings/
  // lists/blockquote/codeblock/history; Underline + Link added on top
  // because they're table-stakes for email (and not in StarterKit).
  // immediatelyRender=false avoids SSR hydration mismatches in Next.
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "underline text-primary" },
      }),
      // Block-level images. Pasted screenshots stack as their own block
      // instead of floating inline with the surrounding text. The channel
      // signature is no longer injected into the editor (it renders as a
      // read-only block below + is appended at send), so we don't need the
      // inline behaviour that used to keep signature graphics on the text
      // line. Roy 2026-07-27.
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: "block max-w-full h-auto" },
      }),
    ],
    content: htmlBody,
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      // Push HTML up to parent state on every change so the send payload
      // always has the latest body without needing an editor ref dance.
      onHtmlBodyChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        // `[&_img]` caps pasted screenshots in the *composer preview* only -
        // this class lives on the contenteditable node, not in getHTML(), so
        // the sent email keeps images at full size. The branded signature is
        // no longer inside the editor (see the read-only preview below).
        class:
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[140px] px-3 py-2 [&_img]:!max-h-40 [&_img]:!w-auto [&_img]:!object-contain",
      },
      // Intercept clipboard image data and route to the parent's file
      // upload pipeline (📎 attachment flow). Non-image clipboard contents
      // fall through to TipTap's default handling so plain text + HTML
      // paste keep working.
      handlePaste: (_view, event) => {
        if (!onPasteFiles) return false
        const items = event.clipboardData?.items
        if (!items) return false
        const files: File[] = []
        for (const item of Array.from(items)) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const f = item.getAsFile()
            if (f) files.push(f)
          }
        }
        if (files.length === 0) return false
        onPasteFiles(files)
        return true
      },
    },
  })

  // Sync editable when disabled toggles (sending state).
  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  // Editor reset: when the parent clears htmlBody to "" after a successful
  // send, force-clear the editor so the composer is empty for the next
  // reply. The signature is NOT injected here anymore - it renders as a
  // read-only preview below and is appended by the parent at send time.
  useEffect(() => {
    if (!editor) return
    if (htmlBody === "" && !editor.isEmpty) {
      editor.commands.clearContent()
    }
  }, [editor, htmlBody])

  // Report the channel signature up to the parent so it can append it to the
  // outgoing email HTML at send time. Trengo placeholders like
  // [agent.first_name] stay literal - Trengo substitutes them server-side.
  useEffect(() => {
    onSignatureChange?.(channel?.signature ?? null)
  }, [channel?.signature, onSignatureChange])

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Header: From / To / CC-BCC toggle / Subject */}
      <div className="divide-y divide-border/60 border-b border-border/60">
        <HeaderRow label="From">
          <span className="truncate text-[13px] text-foreground/80">
            {channel ? formatFrom(channel) : channelQuery.isLoading ? "Loading…" : "-"}
          </span>
          <button
            type="button"
            onClick={() => setCcBccExpanded((v) => !v)}
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            {ccBccExpanded ? "Hide CC/BCC" : "CC / BCC"}
            {ccBccExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        </HeaderRow>
        <HeaderRow label="To">
          <span className="truncate text-[13px] text-foreground/80">{toDisplay}</span>
        </HeaderRow>
        {ccBccExpanded && (
          <>
            <HeaderRow label="CC">
              <EmailChipInput value={cc} onChange={onCcChange} disabled={disabled} placeholder="Add CC recipients…" />
            </HeaderRow>
            <HeaderRow label="BCC">
              <EmailChipInput value={bcc} onChange={onBccChange} disabled={disabled} placeholder="Add BCC recipients…" />
            </HeaderRow>
          </>
        )}
        <HeaderRow label="Subject">
          {/* The 187N global `input[type=text]` rule (theme.css) gives every
              text input a boxed look (border + radius + 11px padding + 14px
              font) — its element+attr selector outranks utility classes, so we
              override with `!` (v4 suffix) to make Subject sit FLUSH like the
              From/To spans and match their row height exactly. Roy 2026-07-26. */}
          <input
            type="text"
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="Re: (uses original subject if blank)"
            disabled={disabled}
            className="w-full flex-1 border-0! bg-transparent! p-0! text-[13px]! text-foreground/80 shadow-none! outline-none! rounded-none! focus:border-0! focus:shadow-none! focus:ring-0! placeholder:text-muted-foreground/45"
          />
        </HeaderRow>
      </div>

      {/* Toolbar */}
      <RichTextToolbar editor={editor} disabled={disabled} />

      {/* Editor body — grows with content (no inner max-height/scroll) so the
          whole composer rides the ONE thread scrollbar instead of spawning a
          second one. Roy 2026-07-26. */}
      <div className="bg-card min-h-[140px]">
        <EditorContent editor={editor} />
      </div>

      {/* Read-only signature block, stacked BELOW the message. Trengo ships
          the signature as raw HTML (often a two-column <table>: salutation
          left, portrait right). The `.inbox-signature-preview` styles force
          everything to stack vertically + cap the portrait so it reads as a
          signature, not a floated image. The original HTML is appended to the
          outgoing mail verbatim by the parent at send time - this is preview
          only. Roy 2026-07-27. */}
      {channel?.signature && (
        <div className="border-t border-border/60 bg-muted/20 px-3.5 py-3">
          <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/55">
            Signature
          </p>
          <div
            className="inbox-signature-preview text-[13px] text-foreground/80"
            dangerouslySetInnerHTML={{ __html: channel.signature }}
          />
        </div>
      )}
    </div>
  )
}

/** One labeled row of the header strip. Fixed mono label gutter (wide enough
 *  for "SUBJECT" so nothing collides) keeps From/To/CC/BCC/Subject aligned in
 *  one column — 187N premium: mono uppercase micro-caps, faint ink. */
function HeaderRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2">
      <span className="w-[68px] shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/55">
        {label}
      </span>
      <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</span>
    </div>
  )
}

/** Rich-text formatting toolbar - Bold/Italic/Underline/Strike/H2/Quote/
 *  Lists/Link/Undo/Redo. Each button calls into the TipTap editor's command
 *  chain and mirrors the active-mark state via `editor.isActive(name)`. */
function RichTextToolbar({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  if (!editor) return null
  const btn = (
    active: boolean,
    onClick: () => void,
    title: string,
    icon: React.ReactNode,
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50",
        active && "bg-muted text-foreground",
      )}
    >
      {icon}
    </button>
  )
  return (
    <div className="border-b border-border/60 px-2 py-1 flex items-center gap-0.5 flex-wrap bg-muted/20">
      {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "Bold (⌘B)", <Bold className="h-3.5 w-3.5" />)}
      {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "Italic (⌘I)", <Italic className="h-3.5 w-3.5" />)}
      {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "Underline (⌘U)", <UnderlineIcon className="h-3.5 w-3.5" />)}
      {btn(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "Strikethrough", <Strikethrough className="h-3.5 w-3.5" />)}
      <span className="h-4 w-px bg-border/60 mx-0.5" aria-hidden />
      {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "Heading", <Heading2 className="h-3.5 w-3.5" />)}
      {btn(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "Quote", <Quote className="h-3.5 w-3.5" />)}
      <span className="h-4 w-px bg-border/60 mx-0.5" aria-hidden />
      {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "Bullet list", <List className="h-3.5 w-3.5" />)}
      {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Numbered list", <ListOrdered className="h-3.5 w-3.5" />)}
      <span className="h-4 w-px bg-border/60 mx-0.5" aria-hidden />
      {btn(editor.isActive("link"), () => promptLink(editor), "Link", <LinkIcon className="h-3.5 w-3.5" />)}
      <span className="h-4 w-px bg-border/60 mx-0.5" aria-hidden />
      {btn(false, () => editor.chain().focus().undo().run(), "Undo (⌘Z)", <Undo className="h-3.5 w-3.5" />)}
      {btn(false, () => editor.chain().focus().redo().run(), "Redo (⌘⇧Z)", <Redo className="h-3.5 w-3.5" />)}
    </div>
  )
}

/** Minimal link-prompt: native window.prompt for now. Could grow into a
 *  small popover later, but the prompt is one-keystroke for the common case
 *  and avoids dragging in an entire popover system for a niche feature. */
function promptLink(editor: Editor) {
  const previous = editor.getAttributes("link").href as string | undefined
  const url = window.prompt("URL", previous ?? "https://")
  if (url === null) return
  if (url === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
    return
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
}

/** Multi-email chip input - comma/space/Enter splits a typed value into a
 *  chip; backspace on empty input removes the last chip; click × on a chip
 *  removes it. No email validation beyond non-empty (Trengo will reject
 *  malformed addresses on send and we surface that error). */
function EmailChipInput({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState("")

  function commitDraft() {
    const t = draft.trim().replace(/[,;]+$/, "").trim()
    if (!t) return
    if (value.includes(t)) {
      setDraft("")
      return
    }
    onChange([...value, t])
    setDraft("")
  }

  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  return (
    <span className="flex-1 min-w-0 inline-flex items-center flex-wrap gap-1">
      {/* Recipient chips: chunkier than the row's dense chrome - email
          context is the centre of attention so the chips earn the visual
          weight. h-7 chip + h-4 hit-area X = comfortable click target. */}
      {value.map((email, i) => (
        <span
          key={`${email}-${i}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/60 h-7 pl-2 pr-1 text-[12px] font-medium text-foreground/90"
        >
          {email}
          <button
            type="button"
            onClick={() => removeAt(i)}
            disabled={disabled}
            aria-label={`Remove ${email}`}
            className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          const v = e.target.value
          // Auto-commit on comma / semicolon / space-after-text
          if (/[,;]/.test(v)) {
            const parts = v
              .split(/[,;\s]+/)
              .map((p) => p.trim())
              .filter(Boolean)
            const fresh = parts.filter((p) => !value.includes(p))
            if (fresh.length > 0) onChange([...value, ...fresh])
            setDraft("")
            return
          }
          setDraft(v)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Tab") {
            if (draft.trim()) {
              e.preventDefault()
              commitDraft()
            }
          } else if (e.key === "Backspace" && !draft && value.length > 0) {
            removeAt(value.length - 1)
          }
        }}
        onBlur={commitDraft}
        placeholder={value.length === 0 ? placeholder : ""}
        disabled={disabled}
        className="min-w-[120px] flex-1 border-0! bg-transparent! p-0! text-[13px]! shadow-none! outline-none! rounded-none! focus:border-0! focus:shadow-none! focus:ring-0! placeholder:text-muted-foreground/45"
      />
    </span>
  )
}

/** Compose a "Name <email>" string for the From row. Falls back to the
 *  channel title when sender info is missing. */
function formatFrom(c: ChannelInfo): string {
  const name = c.senderNamePersonal ?? c.senderName ?? c.title
  if (c.senderEmail) return `${name} <${c.senderEmail}>`
  return name
}

/** Build a reply subject by prepending `Re: ` unless the source already
 *  starts with one (case-insensitive, also tolerates `RE:`, `re:`, `re :`).
 *  Strips outer whitespace. */
function buildReplySubject(source: string): string {
  const s = source.trim()
  if (/^re\s*:/i.test(s)) return s
  return `Re: ${s}`
}

