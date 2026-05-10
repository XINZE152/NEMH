import { useEffect } from 'react';
import { Button, notification } from 'antd';

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

function showError(info) {
  const copyText = buildAiCopyText(info);

  notification.error({
    message: '程序发生错误',
    description: (
      <div style={{ fontSize: 13 }}>
        <div
          style={{
            marginBottom: 8,
            color: '#555',
            wordBreak: 'break-all',
            lineHeight: 1.5,
          }}
        >
          {info.message}
        </div>
        <Button
          size="small"
          onClick={() => {
            navigator.clipboard
              ?.writeText(copyText)
              .then(() => {
                notification.success({
                  message: '已复制，可直接粘贴给 AI',
                  duration: 2,
                });
              })
              .catch(() => {
                notification.warning({ message: '复制失败，请手动复制', duration: 2 });
              });
          }}
        >
          复制错误信息给 AI
        </Button>
      </div>
    ),
    duration: 10,
    placement: 'topRight',
  });
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

export function useGlobalErrorToast() {
  useEffect(() => {
    function onError(event) {
      showError(extractInfo(event.error ?? new Error(event.message || '未知错误')));
    }

    function onUnhandledRejection(event) {
      showError(extractInfo(event.reason));
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);
}
