'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, ChevronDown, ChevronUp, FileText, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser } from '@clerk/nextjs';

type Doc = {
  pageContent?: string;
  metadata?: { loc?: { pageNumber?: number }; source?: string };
  metdata?: { loc?: { pageNumber?: number }; source?: string };
};

type Message = {
  role: 'assistant' | 'user';
  content?: string;
  documents?: Doc[];
};

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:8000';
const MAX_MESSAGE_LENGTH = 1000;

export default function ChatComponent() {
  const { user, isLoaded: isUserLoaded } = useUser();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});

  const historyLoaded = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const storageKey = user?.id ? `pdf-chatbot-history-${user.id}` : null;

  useEffect(() => {
    if (!isUserLoaded) return;
    if (!storageKey) {
      historyLoaded.current = true;
      return;
    }
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      // corrupted storage — start fresh
    }
    historyLoaded.current = true;
  }, [isUserLoaded, storageKey]);

  useEffect(() => {
    if (historyLoaded.current && storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [messages, storageKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      // silently truncate — the Input's maxLength will normally prevent this
      return;
    }
    const query = trimmed;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setLoading(true);

    try {
      const userId = user?.id || 'anonymous';
      const res = await fetch(`${SERVER_URL}/chat?message=${encodeURIComponent(query)}&userId=${encodeURIComponent(userId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error: ${res.status}`);
      }
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.message, documents: data.docs }]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: err.message || 'Could not reach the server. Please make sure it is running.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setExpandedSources({});
  };

  const toggleSources = (index: number) => {
    setExpandedSources(prev => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div className="flex justify-between items-center px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs z-5">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          Chat History ({messages.length} message{messages.length !== 1 ? 's' : ''})
        </span>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearChat}
            className="text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear Chat</span>
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col justify-center items-center text-slate-400 dark:text-slate-600 space-y-4">
            <Bot className="h-16 w-16 text-indigo-500 animate-bounce" />
            <div className="text-center px-4">
              <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300">Welcome to PDF RAG Chatbot!</h3>
              <p className="text-sm max-w-sm mt-1 text-slate-500 dark:text-slate-400">
                Upload a PDF document on the sidebar, then ask questions about its content.
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isUser = msg.role === 'user';
            return (
              <div key={i} className={`flex gap-4 max-w-3xl ${isUser ? 'ml-auto justify-end' : 'mr-auto'}`}>
                {!isUser && (
                  <div className="h-9 w-9 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex justify-center items-center text-indigo-600 dark:text-indigo-400 shadow-sm shrink-0">
                    <Bot className="h-5 w-5" />
                  </div>
                )}

                <div className="flex flex-col space-y-2 max-w-[85%]">
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm shadow-sm leading-relaxed ${
                      isUser
                        ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-none'
                        : 'bg-white dark:bg-slate-900 text-slate-850 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-tl-none'
                    }`}
                  >
                    {msg.content}
                  </div>

                  {!isUser && msg.documents && msg.documents.length > 0 && (
                    <div className="text-xs">
                      <button
                        onClick={() => toggleSources(i)}
                        className="flex items-center gap-1.5 font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline transition"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>{msg.documents.length} Source{msg.documents.length > 1 ? 's' : ''} Referenced</span>
                        {expandedSources[i] ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>

                      {expandedSources[i] && (
                        <div className="mt-2 space-y-2 border-l-2 border-indigo-200 dark:border-indigo-900/50 pl-3 py-1">
                          {msg.documents.map((doc, j) => (
                            <div key={j} className="bg-slate-100 dark:bg-slate-900/60 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 leading-relaxed">
                              <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                [Page {doc.metadata?.loc?.pageNumber || doc.metdata?.loc?.pageNumber || 'N/A'}]
                              </p>
                              <p className="italic text-xs font-normal">"{doc.pageContent?.trim()}"</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="h-9 w-9 rounded-full bg-slate-200 dark:bg-slate-800 flex justify-center items-center text-slate-600 dark:text-slate-400 shadow-sm shrink-0 overflow-hidden">
                    {user?.imageUrl ? (
                      <img src={user.imageUrl} alt="User Profile" className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-5 w-5" />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {loading && (
          <div className="flex gap-4 mr-auto max-w-3xl">
            <div className="h-9 w-9 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex justify-center items-center text-indigo-600 dark:text-indigo-400 shadow-sm shrink-0">
              <Bot className="h-5 w-5" />
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
              <span className="text-sm text-slate-500">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
          className="flex gap-3 max-w-4xl mx-auto"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={loading ? 'Gemini is responding...' : 'Ask a question about the PDF...'}
            disabled={loading}
            maxLength={MAX_MESSAGE_LENGTH}
            className="flex-1 rounded-xl bg-slate-50 dark:bg-slate-950 focus-visible:ring-indigo-500 border-slate-200 dark:border-slate-800"
          />
          <Button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-xl px-5 bg-indigo-600 hover:bg-indigo-700 text-white shrink-0 flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer"
          >
            <span>Send</span>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
