import { render, screen } from '@testing-library/react';
import App from './App';

test('renders login page heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: '欢迎回来' })).toBeInTheDocument();
  expect(screen.getByLabelText('用户名 / 邮箱')).toBeInTheDocument();
  expect(screen.getByLabelText('密码')).toBeInTheDocument();
});
