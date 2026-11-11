import { Link } from 'react-router-dom';

export default function TopNav({ right, showBrand = true }) {
  return (
    <nav className="topnav">
      {showBrand ? (
        <Link to="/" className="brand">
          <span className="brand-icon">🧭</span>
          <span>
            SMVITM Navigate
            <span className="brand-sub">Bantakal, Udupi</span>
          </span>
        </Link>
      ) : <div />}
      <div>{right}</div>
    </nav>
  );
}
