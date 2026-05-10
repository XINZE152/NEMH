import { useCallback, useEffect, useState } from 'react';
import { useGlobalErrorToast } from './useGlobalErrorToast.jsx';
import {
  Button,
  Card,
  Form,
  Input,
  Layout,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
  message,
} from 'antd';

const { Header, Content } = Layout;

const TOKEN_KEY = 'nodejs_admin_token';
const USER_KEY = 'nodejs_admin_user';

async function request(path, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || '请求失败');
    err.status = res.status;
    throw err;
  }
  return data;
}

function LoginPage({ onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const data = await request('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          username: values.username,
          password: values.password,
        }),
      });
      onSuccess({ token: data.token, user: data.user });
      message.success('登录成功');
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card title="管理后台登录" style={{ width: 400 }}>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          首次运行会自动创建用户 admin / admin123
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              placeholder="密码"
              autoComplete="current-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}

function UsersPanel({ authRequest, currentUser, onLogout }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await authRequest('/api/admin/users');
      setRows(list);
    } catch (e) {
      if (e.status === 401) {
        message.warning('登录已失效');
        onLogout();
        return;
      }
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [authRequest, onLogout]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({
      username: record.username,
      password: '',
    });
    setOpen(true);
  };

  const onSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        const body = { username: values.username };
        if (values.password && values.password.trim()) {
          body.password = values.password;
        }
        await authRequest(`/api/admin/users/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        message.success('已更新');
      } else {
        await authRequest('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            username: values.username,
            password: values.password,
          }),
        });
        message.success('已创建');
      }
      setOpen(false);
      load();
    } catch (e) {
      if (e?.errorFields) return;
      if (e.status === 401) {
        message.warning('登录已失效');
        onLogout();
        return;
      }
      message.error(e.message);
    }
  };

  const onDelete = async (record) => {
    try {
      await authRequest(`/api/admin/users/${record.id}`, {
        method: 'DELETE',
      });
      message.success('已删除');
      if (currentUser?.id === record.id) {
        message.info('已删除当前登录用户，请重新登录');
        onLogout();
        return;
      }
      load();
    } catch (e) {
      if (e.status === 401) {
        message.warning('登录已失效');
        onLogout();
        return;
      }
      message.error(e.message);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 72 },
    { title: '用户名', dataIndex: 'username' },
    { title: '创建时间', dataIndex: 'created_at', width: 180 },
    { title: '更新时间', dataIndex: 'updated_at', width: 180 },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title={
              record.id === currentUser?.id
                ? '将删除当前登录用户，删除后需重新登录，确定？'
                : '确定删除该用户？'
            }
            onConfirm={() => onDelete(record)}
            disabled={rows.length <= 1}
          >
            <Button
              type="link"
              size="small"
              danger
              disabled={rows.length <= 1}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            用户管理
          </Typography.Title>
          <Typography.Text type="secondary">
            至少保留一个用户；密码不少于 4 位
          </Typography.Text>
        </div>
        <Button type="primary" onClick={openCreate}>
          新建用户
        </Button>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10 }}
        />
      </Space>

      <Modal
        title={editing ? '编辑用户' : '新建用户'}
        open={open}
        onOk={onSubmit}
        onCancel={() => setOpen(false)}
        destroyOnClose
        width={440}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="用户名" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? '新密码（留空则不修改）' : '密码'}
            rules={
              editing
                ? [
                    {
                      validator: (_, v) => {
                        if (!v || !String(v).trim()) return Promise.resolve();
                        if (String(v).length < 4) {
                          return Promise.reject(new Error('至少 4 位'));
                        }
                        return Promise.resolve();
                      },
                    },
                  ]
                : [
                    { required: true, message: '请输入密码' },
                    { min: 4, message: '至少 4 位' },
                  ]
            }
          >
            <Input.Password
              placeholder={editing ? '不修改请留空' : '至少 4 位'}
              autoComplete="new-password"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function AdminShell({ token, user, onLogout }) {
  const authRequest = useCallback(
    (path, options = {}) => request(path, options, token),
    [token]
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          paddingInline: 16,
        }}
      >
        <Typography.Text style={{ color: '#fff', whiteSpace: 'nowrap' }} strong>
          管理后台 · 用户管理
        </Typography.Text>
        <div style={{ flex: 1 }} />
        <Space size="middle">
          <Typography.Text style={{ color: 'rgba(255,255,255,0.75)' }}>
            {user?.username}
          </Typography.Text>
          <Button type="default" size="small" onClick={onLogout}>
            退出登录
          </Button>
        </Space>
      </Header>
      <Content style={{ background: '#f5f5f5' }}>
        <UsersPanel
          authRequest={authRequest}
          currentUser={user}
          onLogout={onLogout}
        />
      </Content>
    </Layout>
  );
}

export default function App() {
  useGlobalErrorToast();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const handleLoginSuccess = useCallback(({ token: t, user: u }) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (token && !user) {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
    }
  }, [token, user]);

  if (!token || !user) {
    return <LoginPage onSuccess={handleLoginSuccess} />;
  }

  return (
    <AdminShell token={token} user={user} onLogout={handleLogout} />
  );
}
