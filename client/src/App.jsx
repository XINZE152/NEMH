import './App.css';
import ErrorToast from './ErrorToast.jsx';

export default function App() {
  return (
    <div className="app-shell">
      <ErrorToast />
      <nav className="top-nav" aria-label="主导航">
        <div className="top-nav__inner">
          <span className="top-nav__brand">Node 模版</span>
        </div>
      </nav>
      <main className="page">
        <header className="header">
          <h1>欢迎</h1>
          <p className="sub">
            用户端占位首页；管理端请访问开发端口中的 Admin（默认 5174）；进销存业务页在 inventory-web（默认 5173），使用
            admin / admin123 登录。
          </p>
        </header>
      </main>
    </div>
  );
}
