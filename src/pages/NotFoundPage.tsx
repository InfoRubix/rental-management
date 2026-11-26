import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <div className="narrow">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Go to the item catalogue</Link>
      </p>
    </div>
  );
}
