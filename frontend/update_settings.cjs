const fs = require('fs');
const file = 'd:/New_Start/Work/unidesk_frontend/src/pages/settings/SettingsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace("import { useTranslation } from 'react-i18next';", "import { useTranslation } from 'react-i18next';\nimport { useNavigate } from 'react-router-dom';");
content = content.replace("const { t } = useTranslation();", "const { t } = useTranslation();\n    const navigate = useNavigate();");

content = content.replace(/\s*\{\s*id:\s*'workspace'.*?\},/, '');

content = content.replace(
    /<div className="grid grid-cols-1 sm:grid-cols-3 gap-2\">[\s\S]*?<\/div>\s*<\/div>\s*<div className="rounded-2xl border border-\[var\(--color-card-border\)\] bg-white p-5 space-y-5\">/,
    `<div className="grid grid-cols-1 gap-2">
                                    <div className="flex items-center gap-2 rounded-xl border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] shadow-sm">
                                        <Building2 className="w-4 h-4 shrink-0 text-[var(--color-primary)]" />
                                        <span className="truncate">General</span>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 space-y-5">`
);

content = content.replace(
    /<div className="grid grid-cols-1 xl:grid-cols-2 gap-5\">[\s\S]*?<SaveButton onClick=\{handleSave\} saved=\{saved\} \/>/,
    '<SaveButton onClick={handleSave} saved={saved} />'
);

content = content.replace(
    /<div className="border border-\[var\(--color-card-border\)\] rounded-lg overflow-hidden shadow-sm\">\s*<table[\s\S]*?<\/table>\s*<\/div>/,
    `<div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-background)]/35 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div>
                                    <h4 className="text-sm font-bold text-[var(--color-text-primary)]">Full Audit Trail</h4>
                                    <p className="text-xs text-[var(--color-text-muted)] mt-1">Review detailed records of all administrative actions, logins, and settings changes across the platform.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => navigate('/audit-log')}
                                    className="group inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] bg-white border border-[var(--color-card-border)] rounded-lg hover:bg-gray-50 transition-colors shadow-sm whitespace-nowrap"
                                >
                                    <ScrollText className="w-4 h-4 mr-2 text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] transition-colors" />
                                    View Full Audit Log
                                </button>
                            </div>`
);

let workspaceStart = content.indexOf("{activeTab === 'workspace' && (");
if (workspaceStart !== -1) {
    let workspaceEnd = content.indexOf("</div>\n                    )}", workspaceStart);
    if (workspaceEnd !== -1) {
        content = content.substring(0, workspaceStart) + content.substring(workspaceEnd + 31);
    }
}

fs.writeFileSync(file, content);
console.log('SettingsPage.tsx successfully updated via CJS');
