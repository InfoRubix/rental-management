import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { AuthProvider, useMe } from './auth/AuthProvider';
import { AdminLayout, AppLayout, RequireAdmin, RequireAuth } from './components/Layout';
import { Loading } from './components/ui';
import { ConfigProvider } from './lib/config';
import { OfflineBanner, UpdatePrompt } from './pwa/PwaUi';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import CataloguePage from './pages/public/CataloguePage';
import HandoverPage from './pages/public/HandoverPage';
import ProfilePage from './pages/ProfilePage';
import ItemPage from './pages/public/ItemPage';
import MyRequestDetailPage from './pages/public/MyRequestDetailPage';
import MyRequestsPage from './pages/public/MyRequestsPage';

// Loaded on demand so most people download less.
const ScanPage = lazy(() => import('./pages/ScanPage'));
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'));
const ItemsPage = lazy(() => import('./pages/admin/ItemsPage'));
const ItemFormPage = lazy(() => import('./pages/admin/ItemFormPage'));
const ItemDetailPage = lazy(() => import('./pages/admin/ItemDetailPage'));
const RequestsPage = lazy(() => import('./pages/admin/RequestsPage'));
const RequestDetailPage = lazy(() => import('./pages/admin/RequestDetailPage'));
const ActivityPage = lazy(() => import('./pages/admin/ActivityPage'));
const LabelsPage = lazy(() => import('./pages/admin/LabelsPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const RegisterUserPage = lazy(() => import('./pages/admin/RegisterUserPage'));

/** Home page: admins go straight to their dashboard, staff see the item catalogue. */
function Home() {
  const me = useMe();
  return me.role === 'admin' ? <Navigate to="/admin" replace /> : <CataloguePage />;
}

/** The request form is now a pop-up on the item page; old /item/:id/request links open it there. */
function BorrowRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/item/${encodeURIComponent(id)}?borrow=1`} replace />;
}

/** Old /staff/... bookmarks now live under /admin/... */
function StaffRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={pathname.replace(/^\/staff/, '/admin') + search} replace />;
}

export default function App() {
  return (
    <>
      <OfflineBanner />
      <UpdatePrompt />
    <ConfigProvider>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="login" element={<LoginPage />} />
              <Route path="staff/*" element={<StaffRedirect />} />
              <Route path="track/*" element={<Navigate to="/my" replace />} />
              <Route element={<RequireAuth />}>
                <Route element={<RequireAdmin />}>
                  <Route path="admin/labels" element={<LabelsPage />} />
                </Route>
                <Route element={<AppLayout />}>
                  <Route index element={<Home />} />
                  <Route path="item/:id" element={<ItemPage />} />
                  <Route path="item/:id/request" element={<BorrowRedirect />} />
                  <Route path="my" element={<MyRequestsPage />} />
                  <Route path="my/:id" element={<MyRequestDetailPage />} />
                  <Route path="handover/:code" element={<HandoverPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="scan" element={<ScanPage />} />
                  <Route path="admin" element={<RequireAdmin />}>
                    <Route element={<AdminLayout />}>
                      <Route index element={<DashboardPage />} />
                      <Route path="items" element={<ItemsPage />} />
                      <Route path="items/new" element={<ItemFormPage />} />
                      <Route path="items/:id" element={<ItemDetailPage />} />
                      <Route path="items/:id/edit" element={<ItemFormPage />} />
                      <Route path="requests" element={<RequestsPage />} />
                      <Route path="requests/:id" element={<RequestDetailPage />} />
                      <Route path="users" element={<UsersPage />} />
                      <Route path="users/new" element={<RegisterUserPage />} />
                      <Route path="activity" element={<ActivityPage />} />
                    </Route>
                  </Route>
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ConfigProvider>
    </>
  );
}
