import fs from 'fs';
import path from 'path';

const HEADER = `/* ------------------------------------------------------- */
/*  THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)  */
/* ------------------------------------------------------- */

`;

function addHeaderToFiles(filePaths: string[]) {
  if (filePaths.length === 0) {
    return;
  }

  filePaths.forEach((filePath) => {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);

      if (!fs.existsSync(fullPath)) {
        return;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');

      if (content.includes(HEADER)) {
        return;
      }

      const newContent = HEADER + content;

      fs.writeFileSync(fullPath, newContent, 'utf-8');
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  });
}

const files = process.argv.slice(2);

addHeaderToFiles(files);
