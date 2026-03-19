import fs from 'fs';
import path from 'path';

function getFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = dir + '/' + file;
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(getFiles(file));
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            results.push(file);
        }
    });
    return results;
}

const files = getFiles('d:/New_Start/Work/unidesk_frontend/src');

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf-8');
    let original = content;

    // Pattern 1
    content = content.replace(/focus:ring-1 focus:ring-\[var\(--color-input-focus\)\] focus:border-\[var\(--color-input-focus\)\] outline-none/g,
        'focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none');

    // Pattern 2
    content = content.replace(/focus:ring-1 focus:ring-\[var\(--color-input-focus\)\] outline-none/g,
        'focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none');

    // Pattern 3
    content = content.replace(/focus:outline-none focus:ring-1 focus:ring-\[var\(--color-input-focus\)\]/g,
        'focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none');

    // Pattern 4 (FormField.tsx)
    content = content.replace(/focus:border-\[var\(--color-input-focus\)\] focus:outline-none focus:ring-1 focus:ring-\[var\(--color-input-focus\)\]/g,
        'focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none');

    if (content !== original) {
        fs.writeFileSync(file, content);
        console.log(`Updated ${file}`);
    }
});
