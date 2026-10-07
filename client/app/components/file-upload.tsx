'use client';

import { useState } from 'react';
import { Upload, FileText, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { useUser } from '@clerk/nextjs';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:8000';
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const borderStyle: Record<UploadStatus, string> = {
  uploading: 'border-indigo-400 bg-indigo-50/10 dark:bg-indigo-950/10 cursor-not-allowed',
  success: 'border-emerald-500 bg-emerald-50/10 dark:bg-emerald-950/10 cursor-default',
  error: 'border-rose-500 bg-rose-50/10 dark:bg-rose-950/10 cursor-pointer',
  idle: 'border-slate-300 dark:border-slate-800 hover:border-indigo-500 bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-900 cursor-pointer shadow-sm hover:shadow-md',
};

export default function FileUploadComponent() {
  const { user } = useUser();
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [fileName, setFileName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const resetAfter = (ms: number) => setTimeout(() => { setStatus('idle'); setFileName(''); }, ms);

  const openFilePicker = () => {
    if (status === 'uploading') return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;

      // Client-side validation before hitting the server
      if (file.type !== 'application/pdf') {
        setStatus('error');
        setErrorMessage('Only PDF files are accepted.');
        resetAfter(6000);
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setStatus('error');
        setErrorMessage(`File too large. Max ${MAX_FILE_SIZE_MB}MB allowed.`);
        resetAfter(6000);
        return;
      }

      setFileName(file.name);
      setStatus('uploading');
      setErrorMessage('');

      const formData = new FormData();
      formData.append('pdf', file);
      formData.append('userId', user?.id || 'anonymous');

      try {
        const res = await fetch(`${SERVER_URL}/upload/pdf`, { method: 'POST', body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Upload failed: ${res.statusText}`);
        }
        setStatus('success');
        resetAfter(5000);
      } catch (err: any) {
        setStatus('error');
        setErrorMessage(err.message || 'Something went wrong');
        resetAfter(6000);
      }
    });

    input.click();
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      <div
        onClick={openFilePicker}
        className={`w-full border-2 border-dashed rounded-2xl p-8 flex flex-col justify-center items-center gap-4 transition-all duration-300 ${borderStyle[status]}`}
      >
        {status === 'idle' && (
          <>
            <div className="h-12 w-12 rounded-full bg-indigo-50 dark:bg-indigo-900/50 flex justify-center items-center text-indigo-600 dark:text-indigo-400 shadow-sm">
              <Upload className="h-6 w-6" />
            </div>
            <div className="text-center">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Upload PDF File</h3>
              <p className="text-xs text-slate-500 mt-1">Select your PDF document for RAG indexing</p>
            </div>
            <span className="text-[10px] text-slate-400 dark:text-slate-600 font-medium px-2 py-0.5 rounded bg-slate-200/50 dark:bg-slate-850">
              PDF max 10MB
            </span>
          </>
        )}

        {status === 'uploading' && (
          <>
            <div className="relative flex items-center justify-center">
              <Loader2 className="h-12 w-12 text-indigo-500 animate-spin" />
              <FileText className="absolute h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="text-center">
              <h3 className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Uploading File...</h3>
              <p className="text-xs text-slate-500 truncate max-w-[200px] mt-1 font-medium italic">{fileName}</p>
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex justify-center items-center text-emerald-600 dark:text-emerald-400 shadow-sm animate-bounce">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div className="text-center">
              <h3 className="text-sm font-semibold text-emerald-650 dark:text-emerald-400">Success!</h3>
              <p className="text-xs text-slate-500 mt-1">Indexed successfully in Qdrant database</p>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-350 truncate max-w-[200px] mt-2">{fileName}</p>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="h-12 w-12 rounded-full bg-rose-100 dark:bg-rose-950/50 flex justify-center items-center text-rose-600 dark:text-rose-400 shadow-sm animate-pulse">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div className="text-center">
              <h3 className="text-sm font-semibold text-rose-600 dark:text-rose-400">Upload Failed</h3>
              <p className="text-xs text-slate-500 mt-1">{errorMessage}</p>
              <p className="text-[10px] text-rose-500 mt-2 font-medium">Click to try again</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
