const fs = require('fs');
const path = 'c:\\Users\\fabri\\OneDrive\\Área de Trabalho\\Dialogy\\Conexão\\Dialogy\\src\\lib\\types.ts';

let content = fs.readFileSync(path, 'utf8');

// Use a regex to find the Contact type and insert phone_canonical
const contactRegex = /export type Contact = \{([\s\S]*?)\}/;
const match = content.match(contactRegex);

if (match) {
    let contactBody = match[1];
    if (!contactBody.includes('phone_canonical')) {
        // Insert after phone_number_jid if it exists, otherwise at the beginning
        if (contactBody.includes('phone_number_jid?: string;')) {
            contactBody = contactBody.replace('phone_number_jid?: string;', 'phone_number_jid?: string;\n  phone_canonical?: string;');
        } else {
            contactBody = '\n  phone_canonical?: string;' + contactBody;
        }
        
        const newContent = content.replace(contactRegex, `export type Contact = {${contactBody}}`);
        fs.writeFileSync(path, newContent);
        console.log('Successfully updated Contact type with phone_canonical');
    } else {
        console.log('phone_canonical already exists in Contact type');
    }
} else {
    console.log('Could not find Contact type in src/lib/types.ts');
}
