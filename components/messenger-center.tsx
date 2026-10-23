"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock3, Film, ImageIcon, Link2, MessageCircle, Paperclip, PanelRight, RefreshCw, Search, Send, Trash2, UserRound, X } from "lucide-react";
import { STAGES, type CrmState, type CrmUser } from "@/lib/crm/types";
import type { MessengerChannel, MessengerConversation, MessengerMessage, OutgoingMediaAttachment } from "@/lib/messaging/types";
import { uploadMediaFile, type UploadedMedia } from "@/lib/media/client";

type Props = {
  state: CrmState;
  currentUser: CrmUser;
  onOpenLead: (leadId: string) => void;
  onCreateLead: () => void;
};

const channelNames: Record<MessengerChannel, string> = { telegram: "Telegram", whatsapp: "WhatsApp", max: "MAX" };
const channelMarks: Record<MessengerChannel, string> = { telegram: "TG", whatsapp: "WA", max: "MAX" };

function fullDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function time(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function DeliveryIcon({ status }: { status: MessengerMessage["status"] }) {
  if (status === "pending") return <Clock3 size={13} aria-label="Ожидает отправки" />;
  if (status === "delivered" || status === "read") return <CheckCheck size={13} aria-label={status === "read" ? "Прочитано" : "Доставлено"} />;
  if (status === "failed") return <AlertCircle size={13} aria-label="Ошибка отправки" />;
  return <Check size={13} aria-label="Отправлено" />;
}

function MessageMedia({ message }: { message: MessengerMessage }) {
  if (!message.attachments.length) return null;
  return <div className="messenger-media-list">
    {message.attachments.map((attachment, index) => {
      const source = attachment.url || `/api/messaging/media/${message.id}/${index}`;
      if (attachment.type === "image") return <img // eslint-disable-line @next/next/no-img-element
        key={`${message.id}-${index}`} src={source} alt={attachment.name || "Изображение в сообщении"} className="messenger-media" loading="lazy" />;
      if (attachment.type === "video") return <video key={`${message.id}-${index}`} src={source} controls preload="metadata" className="messenger-media">Ваш браузер не поддерживает видео.</video>;
      return <a key={`${message.id}-${index}`} href={source} target="_blank" rel="noreferrer" className="text-sm font-semibold underline">{attachment.name || "Открыть вложение"}</a>;
    })}
  </div>;
}

export function MessengerCenter({ state, currentUser, onOpenLead, onCreateLead }: Props) {
  const [conversations, setConversations] = useState<MessengerConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | MessengerChannel | "unread" | "mine" | "unassigned">("all");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [listError, setListError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<UploadedMedia | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const messageViewport = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shouldStickToBottom = useRef(true);

  const selected = conversations.find((item) => item.id === selectedId);
  const linkedLead = selected?.leadId ? state.leads.find((item) => item.id === selected.leadId) : undefined;
  const owner = linkedLead ? state.users.find((item) => item.id === linkedLead.ownerId) : selected?.ownerId ? state.users.find((item) => item.id === selected.ownerId) : undefined;
  const canAssign = currentUser.role === "Руководитель" || currentUser.role === "РОП";
  const warmupSteps = useMemo(() => state.warmupSequences.flatMap((sequence) => sequence.steps.map((step) => ({ ...step, sequenceName: sequence.name }))).sort((a, b) => a.day - b.day || a.title.localeCompare(b.title, "ru")), [state.warmupSequences]);

  const loadConversations = useCallback(async (quiet = false, search = "") => {
    if (!quiet) setLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("query", search.trim());
      const response = await fetch(`/api/messaging${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const data = await response.json() as { conversations?: MessengerConversation[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить диалоги.");
      const next = data.conversations ?? [];
      setConversations(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? "");
      setListError("");
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Не удалось загрузить диалоги.");
    } finally {
      if (!quiet) setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, before?: string) => {
    setLoadingMessages(true);
    try {
      const params = new URLSearchParams({ conversationId, limit: "40" });
      if (before) params.set("before", before);
      const response = await fetch(`/api/messaging?${params}`, { cache: "no-store" });
      const data = await response.json() as { messages?: MessengerMessage[]; conversations?: MessengerConversation[]; hasMore?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить сообщения.");
      setMessages((current) => before ? [...(data.messages ?? []), ...current] : data.messages ?? []);
      setHasMore(Boolean(data.hasMore));
      if (data.conversations) setConversations(data.conversations);
      setMessageError("");
      if (!before) {
        await fetch(`/api/messaging/conversations/${conversationId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markRead: true })
        });
      }
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Не удалось загрузить сообщения.");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    // Initial synchronization comes from the messaging API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConversations();
  }, [loadConversations]);
  useEffect(() => {
    const timer = window.setInterval(() => void loadConversations(true, query), 15000);
    return () => window.clearInterval(timer);
  }, [loadConversations, query]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversations(true, query), 250);
    return () => window.clearTimeout(timer);
  }, [loadConversations, query]);
  useEffect(() => {
    if (!selectedId) {
      // Selection changes define which external message history is displayed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      return;
    }
    shouldStickToBottom.current = true;
    void loadMessages(selectedId);
  }, [loadMessages, selectedId]);
  useEffect(() => {
    if (shouldStickToBottom.current && messageViewport.current) messageViewport.current.scrollTop = messageViewport.current.scrollHeight;
  }, [messages]);

  const filtered = useMemo(() => {
    return conversations.filter((item) => {
      const matchesFilter = filter === "all"
        || item.channel === filter
        || (filter === "unread" && item.unreadCount > 0)
        || (filter === "mine" && (item.ownerId === currentUser.id || state.leads.find((lead) => lead.id === item.leadId)?.ownerId === currentUser.id))
        || (filter === "unassigned" && !item.ownerId && !item.leadId);
      return matchesFilter;
    });
  }, [conversations, currentUser.id, filter, state.leads]);

  async function send(text = draft, attachment: OutgoingMediaAttachment | UploadedMedia | null = pendingAttachment, clearComposer = true) {
    const clean = text.trim();
    if (!selected || (!clean && !attachment) || sending || uploading) return;
    setSending(true);
    setMessageError("");
    if (clearComposer) { setDraft(""); setPendingAttachment(null); }
    try {
      const response = await fetch("/api/messaging/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selected.id, text: clean, attachment: attachment ? { type: attachment.type, url: attachment.url, name: attachment.name, mimeType: attachment.mimeType } : undefined, idempotencyKey: crypto.randomUUID() })
      });
      const data = await response.json() as { message?: MessengerMessage; error?: string };
      if (data.message) setMessages((current) => [...current.filter((item) => item.id !== data.message?.id), data.message!]);
      await loadConversations(true, query);
      if (!response.ok) throw new Error(data.error || "Сообщение сохранено, но не отправлено.");
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Не удалось отправить сообщение.");
      if (clearComposer) { setDraft(text); setPendingAttachment(attachment as UploadedMedia | null); }
    } finally {
      setSending(false);
    }
  }

  async function attachFile(file?: File) {
    if (!file) return;
    setUploading(true);
    setMessageError("");
    try {
      setPendingAttachment(await uploadMediaFile(file));
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Не удалось загрузить файл.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function selectWarmupStep(stepId: string) {
    const step = warmupSteps.find((item) => item.id === stepId);
    if (!step) return;
    setDraft(step.message);
    setPendingAttachment(step.attachmentUrl && step.attachmentType ? {
      url: step.attachmentUrl,
      type: step.attachmentType,
      name: step.attachmentName || step.title,
      mimeType: step.attachmentType === "image" ? "image/jpeg" : "video/mp4"
    } : null);
  }

  async function updateConversation(changes: Record<string, string | null>) {
    if (!selected) return;
    const response = await fetch(`/api/messaging/conversations/${selected.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes)
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setMessageError(data.error || "Не удалось обновить диалог."); return; }
    await loadConversations(true, query);
  }

  return (
    <section className="messenger-layout" aria-label="Центр сообщений">
      <aside className={clsx("messenger-dialogs", selectedId && "messenger-dialogs-hidden-mobile")}>
        <div className="border-b border-[#E5E7EB] p-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Контакт или сообщение" className="ui-field messenger-search-input" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="ui-field min-w-0 flex-1" aria-label="Фильтр диалогов">
              <option value="all">Все диалоги</option><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option><option value="max">MAX</option>
              <option value="unread">Непрочитанные</option><option value="mine">Мои диалоги</option><option value="unassigned">Без ответственного</option>
            </select>
            <button onClick={() => void loadConversations(false, query)} className="ui-button ui-button-secondary ui-icon-button" title="Обновить диалоги" aria-label="Обновить диалоги"><RefreshCw size={16} /></button>
          </div>
        </div>
        <div className="messenger-dialog-list">
          {loadingList && <div className="p-5 text-sm text-slate-500">Загружаем диалоги...</div>}
          {listError && <div className="m-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{listError}</div>}
          {!loadingList && !listError && filtered.length === 0 && (
            <div className="grid min-h-64 place-items-center p-6 text-center"><div><MessageCircle className="mx-auto text-slate-400" /><strong className="mt-3 block">Диалогов пока нет</strong><p className="mt-1 text-sm text-slate-500">Они появятся после первого входящего сообщения от подключённого бота.</p></div></div>
          )}
          {filtered.map((conversation) => {
            const lead = state.leads.find((item) => item.id === conversation.leadId);
            const conversationOwner = lead
              ? state.users.find((item) => item.id === lead.ownerId)
              : conversation.ownerId ? state.users.find((item) => item.id === conversation.ownerId) : undefined;
            return (
              <button key={conversation.id} onClick={() => setSelectedId(conversation.id)} className={clsx("messenger-dialog-row", selectedId === conversation.id && "messenger-dialog-row-active")}>
                <span className="messenger-avatar">{initials(conversation.contactName)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><strong className="truncate text-sm">{conversation.contactName}</strong><span className={`messenger-channel messenger-channel-${conversation.channel}`}>{channelMarks[conversation.channel]}</span><time className="ml-auto shrink-0 text-xs text-slate-500">{time(conversation.lastMessageAt)}</time></span>
                  <span className="mt-1 flex items-center gap-2"><span className="truncate text-sm text-slate-600">{conversation.lastMessageText}</span>{conversation.unreadCount > 0 && <span className="messenger-unread">{conversation.unreadCount}</span>}</span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{lead ? `${lead.companyName} · ${conversationOwner?.fullName ?? "без ответственного"}` : "Лид не связан"}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className={clsx("messenger-chat", !selectedId && "messenger-chat-hidden-mobile")}>
        {!selected ? (
          <div className="grid h-full place-items-center p-6 text-center"><div><MessageCircle size={30} className="mx-auto text-slate-400" /><strong className="mt-3 block">Выберите диалог</strong><p className="mt-1 text-sm text-slate-500">История и карточка клиента откроются здесь.</p></div></div>
        ) : (
          <>
            <header className="messenger-chat-header">
              <button onClick={() => setSelectedId("")} className="ui-button ui-button-secondary ui-icon-button md:hidden" aria-label="Назад к диалогам"><ArrowLeft size={17} /></button>
              <div className="min-w-0"><strong className="block truncate">{selected.contactName}</strong><span className="block truncate text-xs text-slate-500">{channelNames[selected.channel]} · {selected.phone || selected.username || selected.externalContactId}</span></div>
              {linkedLead && <button onClick={() => onOpenLead(linkedLead.id)} className="ml-auto hidden text-sm font-semibold text-[#4357D9] sm:block">{linkedLead.companyName}</button>}
              <button onClick={() => setShowDetails(true)} className="ui-button ui-button-secondary ui-icon-button ml-auto sm:ml-0 xl:hidden" title="Информация о клиенте" aria-label="Информация о клиенте"><PanelRight size={17} /></button>
            </header>
            <div ref={messageViewport} onScroll={(event) => { const node = event.currentTarget; shouldStickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} className="messenger-message-list">
              {hasMore && <button disabled={loadingMessages} onClick={() => messages[0] && void loadMessages(selected.id, messages[0].sentAt)} className="ui-button ui-button-secondary mx-auto mb-4">{loadingMessages ? "Загружаем..." : "Показать более ранние"}</button>}
              {loadingMessages && messages.length === 0 && <div className="m-auto text-sm text-slate-500">Загрузка переписки...</div>}
              {!loadingMessages && messageError && messages.length === 0 && <div className="m-auto rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Не удалось загрузить сообщения: {messageError}</div>}
              {!loadingMessages && !messageError && messages.length === 0 && <div className="m-auto text-center"><strong>История пуста</strong><p className="mt-1 text-sm text-slate-500">Первое сообщение появится после реального события провайдера.</p></div>}
              {messages.map((message) => (
                <article key={message.id} className={clsx("messenger-bubble", message.direction === "outbound" ? "messenger-bubble-out" : "messenger-bubble-in", message.status === "failed" && "messenger-bubble-failed")}>
                  <MessageMedia message={message} />
                  {message.text && <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.text}</p>}
                  <footer className="mt-1 flex items-center justify-end gap-1 text-[11px] opacity-70"><time>{fullDate(message.sentAt)}</time>{message.direction === "outbound" && <DeliveryIcon status={message.status} />}</footer>
                  {message.errorReason && <p className="mt-2 border-t border-current/15 pt-2 text-xs">{message.errorReason}</p>}
                  {message.status === "failed" && <button disabled={sending} onClick={() => { const media = message.attachments.find((item): item is OutgoingMediaAttachment => (item.type === "image" || item.type === "video") && Boolean(item.url)); void send(message.text, media ?? null, false); }} className="mt-2 text-xs font-bold underline">Повторить безопасно</button>}
                </article>
              ))}
            </div>
            {messageError && messages.length > 0 && <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{messageError}</div>}
            <div className="messenger-composer-wrap">
              <div className="messenger-composer-tools">
                <select defaultValue="" onChange={(event) => { selectWarmupStep(event.target.value); event.target.value = ""; }} className="ui-field min-w-0" aria-label="Выбрать материал прогрева">
                  <option value="">Материал прогрева...</option>
                  {warmupSteps.map((step) => <option key={step.id} value={step.id}>День {step.day} · {step.title}</option>)}
                </select>
                {pendingAttachment && <div className="messenger-attachment-preview">
                  {pendingAttachment.type === "image" ? <ImageIcon size={16} /> : <Film size={16} />}
                  <span className="truncate">{pendingAttachment.name}</span>
                  <button type="button" onClick={() => setPendingAttachment(null)} className="ui-icon-button" title="Убрать вложение" aria-label="Убрать вложение"><Trash2 size={15} /></button>
                </div>}
              </div>
              <form onSubmit={(event: FormEvent) => { event.preventDefault(); void send(); }} className="messenger-composer">
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(event) => void attachFile(event.target.files?.[0])} className="sr-only" />
                <button type="button" onClick={() => fileInput.current?.click()} disabled={sending || uploading} className="ui-button ui-button-secondary ui-icon-button" title="Прикрепить фото или видео" aria-label="Прикрепить фото или видео"><Paperclip size={17} /></button>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={1} maxLength={4000} placeholder={uploading ? "Загружаем файл..." : "Напишите сообщение"} className="ui-field min-h-11 max-h-32 resize-y" />
                <button disabled={sending || uploading || (!draft.trim() && !pendingAttachment)} className="ui-button ui-button-primary ui-icon-button" title="Отправить" aria-label="Отправить"><Send size={17} /></button>
              </form>
            </div>
          </>
        )}
      </div>

      <aside className={clsx("messenger-details", showDetails && "messenger-details-open")}>
        <div className="flex items-start justify-between border-b border-[#E5E7EB] p-4"><div><span className="text-xs font-semibold uppercase text-slate-500">Клиент</span><strong className="mt-1 block">{selected?.contactName ?? "Диалог не выбран"}</strong></div><button onClick={() => setShowDetails(false)} className="ui-button ui-button-secondary ui-icon-button xl:hidden" aria-label="Закрыть"><X size={17} /></button></div>
        {selected && <div className="grid gap-5 overflow-y-auto p-4">
          <dl className="grid gap-3 text-sm">
            <div><dt className="text-xs text-slate-500">Канал</dt><dd className="mt-1 font-semibold">{channelNames[selected.channel]}</dd></div>
            <div><dt className="text-xs text-slate-500">Контакт</dt><dd className="mt-1 break-all font-semibold">{selected.phone || selected.username || selected.externalContactId}</dd></div>
            <div><dt className="text-xs text-slate-500">Состояние</dt><dd className="mt-1 font-semibold">{selected.status === "open" ? "Открыт" : selected.status === "waiting" ? "Ожидает ответа" : "Закрыт"}</dd></div>
          </dl>
          <div className="border-t border-[#E5E7EB] pt-4">
            <div className="mb-2 flex items-center gap-2"><Link2 size={16} /><strong className="text-sm">Связь с CRM</strong></div>
            {canAssign ? <div className="grid gap-2">
              <select value={selected.leadId ?? ""} onChange={(event) => void updateConversation({ leadId: event.target.value || null, ownerId: event.target.value ? state.leads.find((lead) => lead.id === event.target.value)?.ownerId ?? null : null })} className="ui-field" aria-label="Связанный лид">
                <option value="">Лид не выбран</option>{state.leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.companyName} · {lead.contactName}</option>)}
              </select>
              {!linkedLead && <button onClick={onCreateLead} className="ui-button ui-button-secondary"><UserRound size={16} /> Создать лида</button>}
            </div> : <p className="text-sm text-slate-600">{linkedLead ? linkedLead.companyName : "Лид не связан"}</p>}
          </div>
          {linkedLead && <div className="grid gap-3 border-t border-[#E5E7EB] pt-4 text-sm"><div><span className="text-xs text-slate-500">Лид</span><strong className="block">{linkedLead.companyName}</strong></div><div><span className="text-xs text-slate-500">Этап</span><strong className="block">{STAGES[linkedLead.stage]}</strong></div><div><span className="text-xs text-slate-500">Ответственный</span><strong className="block">{owner?.fullName ?? "Не назначен"}</strong></div><button onClick={() => onOpenLead(linkedLead.id)} className="ui-button ui-button-secondary">Открыть карточку лида</button></div>}
          <label className="ui-label border-t border-[#E5E7EB] pt-4">Заметки<textarea defaultValue={selected.notes} onBlur={(event) => { if (event.target.value !== selected.notes) void updateConversation({ notes: event.target.value }); }} rows={4} className="ui-field resize-y" placeholder="Контекст для команды" /></label>
          <label className="ui-label">Статус<select value={selected.status} onChange={(event) => void updateConversation({ status: event.target.value })} className="ui-field"><option value="open">Открыт</option><option value="waiting">Ожидает ответа</option><option value="closed">Закрыт</option></select></label>
        </div>}
      </aside>
      {showDetails && <button className="messenger-details-backdrop xl:hidden" onClick={() => setShowDetails(false)} aria-label="Закрыть информацию о клиенте" />}
    </section>
  );
}
