import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './pages/landing';
import Register from './pages/auth/Register';
import Login from './pages/auth/Login';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import VerifyEmail from './pages/auth/VerifyEmail';
import AuthCodePage from './pages/auth/AuthCodePage';
import LegalPage from './pages/legal/LegalPage';
import OnboardingPage from './pages/auth/OnboardingPage';
import MfaSetup from './components/MfaSetup';
import RequireAuth from './components/RequireAuth';
import RequirePermission from './components/RequirePermission';
import MainLayout from './layouts/MainLayout';
import { DashboardLayout } from './pages/dashboard/DashboardLayout';
import AcceptInvite from './pages/auth/AcceptInvite';

import Dashboard from './pages/dashboard/UserDashboard';
import InboxPage from './pages/dashboard/inbox/InboxPage';
import SettingsPage from './pages/dashboard/settings/SettingsPage';
import ProfilePage from './pages/dashboard/profile/ProfilePage';
import PlansPage from './pages/plans/PlansPage';
import BillingManagePage from './pages/billing/BillingManagePage';
import SuccessPage from './pages/billing/SuccessPage';

import CalendarPage from './pages/dashboard/calendar/CalendarPage';
import ContactsPage from './pages/dashboard/contacts/ContactsPage';
import ReportsPage from './pages/dashboard/reports/ReportsPage';
import RulesPage from './pages/dashboard/rules/RulesPage';
import SLAPage from './pages/dashboard/sla/SLAPage';
import SignaturesPage from './pages/dashboard/signatures/SignaturesPage';
import TemplatesPage from './pages/dashboard/templates/TemplatesPage';
import NotificationsPage from './pages/dashboard/notifications/NotificationsPage';
import WebhooksPage from './pages/dashboard/webhooks/WebhooksPage';
import ExportPage from './pages/dashboard/export/ExportPage';
import { WebSocketProvider } from './context/WebSocketContext';
import { NotificationProvider } from './context/NotificationContext';

function App() {
    return (
        <WebSocketProvider>
            <NotificationProvider>
            <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/signup" element={<Register />} />
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/auth-code" element={<AuthCodePage />} />
                <Route path="/privacy" element={<LegalPage />} />
                <Route path="/terms" element={<LegalPage />} />
                <Route path="/onboarding" element={<OnboardingPage />} />
                <Route path="/accept-invite" element={<AcceptInvite />} />
                <Route path="/invite/:token" element={<AcceptInvite />} />

                <Route element={
                    <RequireAuth>
                        <DashboardLayout>
                            <MainLayout />
                        </DashboardLayout>
                    </RequireAuth>
                }>
                    <Route path="/mfa-setup" element={<MfaSetup />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/inbox/thread/:threadId" element={<InboxPage />} />
                    <Route path="/inbox/:filter" element={<InboxPage />} />
                    <Route path="/inbox" element={<InboxPage />} />
                    <Route path="/calendar" element={<RequirePermission permission="calendar:view"><CalendarPage /></RequirePermission>} />
                    <Route path="/contacts" element={<RequirePermission permission="contacts:view"><ContactsPage /></RequirePermission>} />
                    <Route path="/reports" element={<RequirePermission permission="organization:view"><ReportsPage /></RequirePermission>} />
                    <Route path="/analytics" element={<RequirePermission permission="organization:view"><ReportsPage /></RequirePermission>} />
                    <Route path="/billing/plans" element={<RequirePermission permission="organization:manage"><PlansPage /></RequirePermission>} />
                    <Route
                        path="/plans"
                        element={
                            <RequirePermission permission="organization:manage">
                                <Navigate to="/billing/plans" replace />
                            </RequirePermission>
                        }
                    />
                    <Route path="/billing/manage" element={<RequirePermission permission="organization:manage"><BillingManagePage /></RequirePermission>} />
                    <Route path="/checkout/success" element={<RequirePermission permission="organization:manage"><SuccessPage /></RequirePermission>} />
                    <Route
                        path="/settings/billing"
                        element={
                            <RequirePermission permission="organization:manage">
                                <Navigate to="/billing/manage" replace />
                            </RequirePermission>
                        }
                    />
                    <Route
                        path="/dashboard/settings"
                        element={
                            <RequirePermission permission="organization:view">
                                <Navigate to="/settings/organization" replace />
                            </RequirePermission>
                        }
                    />
                    <Route
                        path="/dashboard/automation"
                        element={
                            <RequirePermission permission="rules:view">
                                <Navigate to="/rules" replace />
                            </RequirePermission>
                        }
                    />

                    {/* New Module Routes */}
                    <Route path="/tags" element={<Navigate to="/settings/organization?tab=tags" replace />} />
                    <Route path="/rules" element={<RequirePermission permission="rules:view"><RulesPage /></RequirePermission>} />
                    <Route path="/sla" element={<RequirePermission permission="sla_policies:view"><SLAPage /></RequirePermission>} />
                    <Route path="/signatures" element={<RequirePermission permission="signatures:view"><SignaturesPage /></RequirePermission>} />
                    <Route path="/templates" element={<RequirePermission permission="templates:view"><TemplatesPage /></RequirePermission>} />
                    <Route path="/notifications" element={<NotificationsPage />} />
                    <Route path="/webhooks" element={<RequirePermission permission="webhooks:view"><WebhooksPage /></RequirePermission>} />
                    <Route
                        path="/audit"
                        element={
                            <RequirePermission permission="audit:view">
                                <Navigate to="/settings/organization?tab=audit" replace />
                            </RequirePermission>
                        }
                    />
                    <Route path="/export" element={<RequirePermission permission="organization:manage"><ExportPage /></RequirePermission>} />

                    <Route path="/settings">
                        <Route index element={<Navigate to="/settings/organization" replace />} />
                        <Route path="organization" element={<RequirePermission permission="organization:view"><SettingsPage /></RequirePermission>} />
                        <Route path="profile" element={<ProfilePage />} />
                        <Route
                            path="teams"
                            element={
                                <RequirePermission permission="teams:view">
                                    <Navigate to="/settings/organization?tab=teams" replace />
                                </RequirePermission>
                            }
                        />
                        <Route
                            path="mailboxes"
                            element={
                                <RequirePermission permission="mailboxes:view">
                                    <Navigate to="/settings/organization?tab=mailboxes" replace />
                                </RequirePermission>
                            }
                        />
                        <Route
                            path="users"
                            element={
                                <RequirePermission permission="users:view">
                                    <Navigate to="/settings/organization?tab=users" replace />
                                </RequirePermission>
                            }
                        />
                    </Route>
                </Route>
            </Routes>
            </NotificationProvider>
        </WebSocketProvider>
    );
}

export default App;
