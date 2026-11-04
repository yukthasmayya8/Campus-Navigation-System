import { Link } from 'react-router-dom';

export default function TopNav({ right }) {
  return (
    <header className="topnav">
      <Link to="/" className="brand">Campus Navigation</Link>
      <nav>{right ?? <Link to="/admin/login" className="navlink">Login</Link>}</nav>
    </header>
  );
}
