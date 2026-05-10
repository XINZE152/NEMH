import { useCallback, useEffect, useState } from 'react';
import './ErrorToast.css';

let _id = 0;

function buildAiCopyText({ message, name, stack, time, url }) {
  return [
    '我在使用应用时遇到了以下错误，请帮我排查：',
    '',
    `错误信息：${message}`,
    `错误类型：${name}`,
    `发生时间：${time}`,
    `页面地址：${url}`,
    '',
    '错误堆栈：',
    stack || '（无堆栈信息）',
  ].join('\n');
}

function extractInfo(err) {
  const isError = err instanceof Error;
  return {
    message: isError ? err.message : String(err ?? '未知错误'),
    name: isError ? (err.name || 'Error') : 'Error',
    stack: isError ? (err.stack || '') : '',
    time: new Date().toLocaleString(),
    url: location.href,
  };
}

function ToastItem({ info, onClose }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      ?.writeText(buildAiCopyText(info))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }, [info]);

  return (
    <div className="error-toast" role="alert">
      <div className="error-toast__header">
        <span className="error-toast__title">⚠ 程序发生错误</span>
        <button className="error-toast__close" onClick={onClose} aria-label="关闭">×</button>
      </div>
      <div className="error-toast__message">{info.message}</div>
      <button
        className={`error-toast__copy-btn${copied ? ' error-toast__copy-btn--ok' : ''}`}
        onClick={handleCopy}
      >
        {copied ? '✓ 已复制' : '复制错误信息给 AI'}
      </button>
    </div>
  );
}

export default function ErrorToast() {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((info) => {
    const id = ++_id;
    setToasts((prev) => [...prev, { id, info }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 12000);
  }, []);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    function onError(event) {
      push(extractInfo(event.error ?? new Error(event.message || '未知错误')));
    }
    function onUnhandledRejection(event) {
      push(extractInfo(event.reason));
    }
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [push]);

  if (toasts.length === 0) return null;

  return (
    <div className="error-toast-container">
      {toasts.map(({ id, info }) => (
        <ToastItem key={id} info={info} onClose={() => remove(id)} />
      ))}
    </div>
  );
}
