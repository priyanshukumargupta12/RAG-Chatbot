import { UserButton } from '@clerk/nextjs';
import { currentUser } from '@clerk/nextjs/server';
import FileUploadComponent from './components/file-upload';
import ChatComponent from './components/chat';

export default async function Home() {
  const user = await currentUser();
  const displayName = user ? (user.firstName || user.username || 'User') : 'User';

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {/* Header with user button */}
      <header className="flex justify-between items-center px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm z-10">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-indigo-600 animate-pulse" />
          <h1 className="font-bold text-xl text-slate-800 dark:text-white tracking-tight">PDF RAG Chatbot</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full font-bold">
            Welcome, {displayName}!
          </span>
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left pane: File upload */}
        <aside className="w-[30%] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-6 flex flex-col justify-center items-center gap-4">
          <FileUploadComponent />
        </aside>

        {/* Right pane: Chat */}
        <main className="flex-1 h-full bg-slate-50 dark:bg-slate-950 relative">
          <ChatComponent />
        </main>
      </div>
    </div>
  );
}

