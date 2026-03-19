import React from 'react';
import { CheckCircle2, Shield, Smartphone } from 'lucide-react';

interface InviteMfaSetupStepProps {
    email: string;
    organizationName: string;
    totpCode: string;
    qrCodeDataUrl?: string | null;
    otpauthUrl?: string | null;
    setupLoading?: boolean;
    onTotpCodeChange: (value: string) => void;
    onBack: () => void;
    onSubmit: (event: React.FormEvent) => void;
    loading: boolean;
    error?: string;
}

export default function InviteMfaSetupStep({
    email,
    organizationName,
    totpCode,
    qrCodeDataUrl,
    otpauthUrl,
    setupLoading,
    onTotpCodeChange,
    onBack,
    onSubmit,
    loading,
    error,
}: InviteMfaSetupStepProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-5">
            <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-background)]/35 p-4">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)]/25 text-[var(--color-primary)] flex items-center justify-center shrink-0">
                        <Shield className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">MFA Setup Required</h3>
                        <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">
                            {organizationName} enforces multi-factor authentication. Complete TOTP setup before finishing your invitation.
                        </p>
                    </div>
                </div>
            </div>

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-4">
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-4">
                    <div className="aspect-square rounded-xl border border-dashed border-[var(--color-card-border)] bg-[var(--color-background)] flex flex-col items-center justify-center text-center p-4">
                        {setupLoading ? (
                            <>
                                <span className="w-8 h-8 border-2 border-[var(--color-primary)]/40 border-t-transparent rounded-full animate-spin mb-3" />
                                <div className="text-xs font-semibold text-[var(--color-text-primary)]">Generating QR code...</div>
                            </>
                        ) : qrCodeDataUrl ? (
                            <>
                                <img src={qrCodeDataUrl} alt="MFA QR code" className="w-full max-w-[150px] rounded-md bg-white p-1" />
                                <div className="text-[11px] text-[var(--color-text-muted)] mt-2">Scan with Google Authenticator</div>
                            </>
                        ) : (
                            <>
                                <Smartphone className="w-8 h-8 text-[var(--color-primary)] mb-3" />
                                <div className="text-xs font-semibold text-[var(--color-text-primary)]">Unable to load QR code</div>
                                <div className="text-[11px] text-[var(--color-text-muted)] mt-1">Use setup link below</div>
                            </>
                        )}
                    </div>
                </div>

                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Invited Email</label>
                        <input
                            type="email"
                            disabled
                            value={email}
                            className="w-full px-3 py-2.5 border border-[var(--color-input-border)] rounded-xl text-sm bg-[var(--color-background)] text-[var(--color-text-muted)]"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Enter 6-digit TOTP Code</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            required
                            value={totpCode}
                            onChange={(e) => onTotpCodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            className="w-full px-3 py-2.5 border border-[var(--color-input-border)] rounded-xl text-sm tracking-[0.25em] text-center font-mono text-[var(--color-text-primary)] bg-white focus:ring-2 focus:ring-[var(--color-primary)]/20"
                        />
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                            Enter the code shown in your authenticator app to finalize account setup.
                        </p>
                        {otpauthUrl && (
                            <a
                                href={otpauthUrl}
                                className="mt-2 inline-block text-xs text-[var(--color-primary)] hover:underline break-all"
                            >
                                Open authenticator setup link
                            </a>
                        )}
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                        <button
                            type="button"
                            onClick={onBack}
                            disabled={loading}
                            className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)] rounded-lg transition-colors disabled:opacity-60"
                        >
                            Back
                        </button>
                        <button
                            type="submit"
                            disabled={loading || totpCode.length !== 6}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)] transition-colors disabled:opacity-60"
                        >
                            {loading ? (
                                <>
                                    <span className="w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                                    Finalizing...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="w-4 h-4" />
                                    Finish Invitation
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </form>
    );
}
