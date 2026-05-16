import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import './agentstudioPreviewBridge.js';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorSuccess: '#2196F3',
          colorSuccessBg: '#e3f2fd',
          colorSuccessBorder: '#90caf9',
          colorSuccessHover: '#1976D2',
          colorSuccessActive: '#1565C0',
        },
      }}
    >
      <App />
    </ConfigProvider>
  </StrictMode>
);
