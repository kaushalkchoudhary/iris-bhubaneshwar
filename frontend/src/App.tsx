import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { DeviceFilterProvider } from './contexts/DeviceFilterContext';
import { LayerVisibilityProvider } from './contexts/LayerVisibilityContext';
import { CameraGridProvider } from './contexts/CameraGridContext';
import { CrowdDashboardProvider } from './contexts/CrowdDashboardContext';
import { MapTypeProvider } from './contexts/MapTypeContext';
import { MainLayout } from './components/layout/MainLayout';
import { CoreSpinLoader } from './components/ui/core-spin-loader';
import { LoginPage } from './components/auth/LoginPage';
import { OperatorResetPage } from './components/auth/OperatorResetPage';
import { Logout } from './components/auth/Logout';
import { HomePage } from './components/home/HomePage';
import { CameraView } from './components/cameras/CameraView';
import { CrowdDashboard } from './components/crowd/CrowdDashboard';
import { CrowdFRSPage } from './components/crowd/CrowdFRSPage';
import { ANPRDashboard } from './components/anpr/ANPRDashboard';
import { VCCDashboard } from './components/vcc/VCCDashboard';
import { WatchlistManagement } from './components/itms/WatchlistManagement';
import { AlertsPage } from './components/itms/AlertsPage';
import { WorkersDashboard } from './components/workers/WorkersDashboard';
import { AnalyticsReporting } from './components/itms/AnalyticsReporting';
import { SettingsPage } from './components/settings/SettingsPage';
import { OperatorAccessPage } from './components/settings/OperatorAccessPage';
import { AnalyticsPage } from './components/analytics/AnalyticsPage';
import { ReportsPage } from './components/reports/ReportsPage';

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full w-full min-h-screen bg-background">
      <CoreSpinLoader />
    </div>
  );
}



import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <DeviceFilterProvider>
            <LayerVisibilityProvider>
              <CameraGridProvider>
                <CrowdDashboardProvider>
                  <MapTypeProvider>
                    <Routes>
                      <Route path="/login" element={<LoginPage />} />
                      <Route path="/operator-reset" element={<OperatorResetPage />} />
                      <Route path="/logout" element={<Logout />} />

                      {/* Protected Routes */}
                      <Route path="/" element={
                        <ProtectedRoute>
                          <MainLayout>
                            <Suspense fallback={<PageLoader />}>
                              <HomePage />
                            </Suspense>
                          </MainLayout>
                        </ProtectedRoute>
                      } />

                      <Route path="/crowd-analytics" element={
                        <ProtectedRoute>
                          <MainLayout>
                            <Suspense fallback={<PageLoader />}>
                              <CrowdDashboard />
                            </Suspense>
                          </MainLayout>
                        </ProtectedRoute>
                      } />
                      <Route path="/map" element={<Navigate to="/crowd-analytics" replace />} />

                      <Route path="/live-feed" element={
                        <ProtectedRoute>
                          <MainLayout>
                            <Suspense fallback={<PageLoader />}>
                              <CameraView />
                            </Suspense>
                          </MainLayout>
                        </ProtectedRoute>
                      } />
                      <Route path="/cameras" element={<Navigate to="/live-feed" replace />} />

                      <Route path="/itms/*" element={
                        <ProtectedRoute>
                          <MainLayout>
                            <Suspense fallback={<PageLoader />}>
                              <Routes>
                                <Route path="/" element={<Navigate to="/itms/anpr" replace />} />
                                <Route path="/anpr" element={<ANPRDashboard />} />
                                <Route path="/vcc" element={<VCCDashboard />} />
                                <Route path="/watchlist" element={<WatchlistManagement />} />
                                <Route path="/analytics" element={<AnalyticsReporting />} />
                                <Route path="/investigation" element={<Navigate to="/itms/analytics" replace />} />
                                <Route path="/devices" element={<Navigate to="/itms/analytics" replace />} />
                                <Route path="/watchlist/rules" element={<Navigate to="/itms/watchlist" replace />} />
                              </Routes>
                            </Suspense>
                          </MainLayout>
                        </ProtectedRoute>
                      } />

                      <Route path="/frs" element={
                        <ProtectedRoute>
                          <MainLayout>
                            <Suspense fallback={<PageLoader />}>
                              <CrowdFRSPage />
                            </Suspense>
                          </MainLayout>
                        </ProtectedRoute>
                      } />
                      <Route path="/public-safety" element={<Navigate to="/frs" replace />} />
                      <Route path="/crowd" element={<Navigate to="/frs" replace />} />

                      <Route path="/dashboard" element={
                        <ProtectedRoute>
                          <MainLayout>
                            <Suspense fallback={<PageLoader />}>
                              <AnalyticsPage />
                            </Suspense>
                          </MainLayout>
                        </ProtectedRoute>
                      } />
                      <Route path="/analytics" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/reports" element={
                        <ProtectedRoute>
                          <MainLayout>
                            <Suspense fallback={<PageLoader />}>
                              <ReportsPage />
                            </Suspense>
                          </MainLayout>
                        </ProtectedRoute>
                      } />

                      <Route path="/analytics/alerts" element={
                        <ProtectedRoute>
                          <MainLayout>
                            <Suspense fallback={<PageLoader />}>
                              <AlertsPage />
                            </Suspense>
                          </MainLayout>
                        </ProtectedRoute>
                      } />
                      <Route path="/alerts" element={<Navigate to="/analytics/alerts" replace />} />
                      <Route path="/itms/alerts" element={<Navigate to="/analytics/alerts" replace />} />

                      <Route path="/settings/*" element={
                        <ProtectedRoute>
                          <MainLayout>
                            <Suspense fallback={<PageLoader />}>
                              <Routes>
                                <Route path="/" element={<SettingsPage />} />
                                <Route path="/workers" element={<WorkersDashboard />} />
                                <Route path="/workers/:id" element={<WorkersDashboard />} />
                                <Route path="/operators" element={<OperatorAccessPage />} />
                              </Routes>
                            </Suspense>
                          </MainLayout>
                        </ProtectedRoute>
                      } />

                      {/* Catch all */}
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </MapTypeProvider>
                </CrowdDashboardProvider>
              </CameraGridProvider>
            </LayerVisibilityProvider>
          </DeviceFilterProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
