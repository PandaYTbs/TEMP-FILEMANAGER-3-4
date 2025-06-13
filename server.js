const express = require('express');
const app = express();
const exphbs = require('express-handlebars');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const archiver = require('archiver');
const formidable = require('formidable');

const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'FILES');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use('/files', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
}, express.static(path.join(__dirname, 'FILES')));
app.use(express.static('static'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.engine('hbs', exphbs.engine({
    extname: 'hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views/layouts')
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

function sanitizePath(inputPath) {
    return inputPath.replace(/\.\./g, '').replace(/\\/g, '/');
}


function buildBreadcrumbs(pathStr) {
    const parts = pathStr.split('/').filter(Boolean);
    let current = '';
    return parts.map(part => {
        current += (current ? '/' : '') + part;
        return { name: part, path: current };
    });
}
// Filemanager routes
app.get('/', (req, res) => res.redirect('/filemanager'));


app.get('/image-editor', (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
        return res.status(400).send('Brak pliku do edycji');
    }

    const fullPath = path.join(__dirname, 'FILES', filePath.replace('/files/', ''));
    
    if (!fs.existsSync(fullPath)) {
        return res.status(404).send('Obraz nie istnieje');
    }

    res.render('image', { 
        file: `/files/${filePath.replace('/files/', '')}` 
    });
});

app.get('/filemanager', (req, res) => {
    try {
        const root = sanitizePath(req.query.root || '');
        const currentPath = path.join(UPLOAD_DIR, root);

        if (!fs.existsSync(currentPath)) {
            return res.status(404).render('error', { message: 'Directory not found' });
        }

        const items = fs.readdirSync(currentPath, { withFileTypes: true });
        
        const folders = items.filter(item => item.isDirectory())
            .map(item => ({
                name: item.name,
                path: path.join(root, item.name).replace(/\\/g, '/')
            }));
        
        const files = items.filter(item => item.isFile())
            .map(item => ({
                name: item.name,
                path: path.join(root, item.name).replace(/\\/g, '/')
            }));

            res.render('filemanager', {
                folders,
                files,
                currentPath: root,
                hasParent: root !== '',
                parentPath: path.dirname(root).replace(/\\/g, '/'),
                breadcrumbs: buildBreadcrumbs(root),
                currentDirName: path.basename(root) || ''
            });
    } catch (err) {
        console.error('Filemanager error:', err);
        res.status(500).render('error', { message: 'Internal server error' });
    }
});

// Editor routes
app.get('/edit-file', (req, res) => {
    try {
        const filePath = sanitizePath(req.query.path || '');
        const fullPath = path.join(UPLOAD_DIR, filePath);

        if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
            return res.status(404).render('error', { message: 'File not found' });
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        res.render('editor', {
            filePath: filePath,
            fileName: path.basename(filePath),
            fileContent: content
        });
    } catch (err) {
        console.error('Edit error:', err);
        res.status(500).render('error', { message: 'Internal server error' });
    }
});

app.post('/save-file', (req, res) => {
    try {
        const { filePath, content } = req.body;
        const safePath = sanitizePath(filePath);
        const fullPath = path.join(UPLOAD_DIR, safePath);

        fs.writeFileSync(fullPath, content, 'utf8');
        res.json({ success: true, message: 'File saved successfully' });
    } catch (err) {
        console.error('Save error:', err);
        res.status(500).json({ error: 'Failed to save file' });
    }
});


app.post('/save-image', async (req, res) => {
    const form = new formidable.IncomingForm();
    
    form.parse(req, async (err, fields, files) => {
        if (err) {
            console.error('Błąd parsowania formularza:', err);
            return res.status(500).json({ error: 'Błąd parsowania formularza' });
        }

        // Debugowanie - wyświetl odebrane dane
        console.log('Odebrane fields:', fields);
        console.log('Odebrane files:', files);

        // Pobierz wartości z formularza
        const filePath = fields?.path?.[0] || fields?.path;
        const uploadedFile = files?.file?.[0] || files?.file;

        if (!filePath || !uploadedFile?.filepath) {
            console.error('Brakujące dane:', { filePath, uploadedFile });
            return res.status(400).json({ 
                error: 'Brak wymaganych danych',
                details: {
                    receivedPath: !!filePath,
                    receivedFile: !!uploadedFile,
                    fileHasPath: !!uploadedFile?.filepath
                }
            });
        }

        try {
            // Ścieżka do oryginalnego pliku
            const sanitizedPath = filePath.replace(/^\/files\//, '');
            const fullPath = path.join(__dirname, 'FILES', sanitizedPath);
            
            console.log('Zapisywanie pliku:', {
                tempPath: uploadedFile.filepath,
                destination: fullPath
            });

            // Utwórz katalog jeśli nie istnieje
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Przenieś plik
            fs.renameSync(uploadedFile.filepath, fullPath);
            
            console.log('Plik zapisany pomyślnie');
            res.json({ success: true, path: fullPath });
        } catch (error) {
            console.error('Błąd zapisu:', {
                error: error.message,
                stack: error.stack
            });
            res.status(500).json({ 
                error: 'Błąd podczas zapisywania pliku',
                details: error.message 
            });
        }
    });
});

app.get('/get-config', (req, res) => {
    const configPath = path.join(UPLOAD_DIR, 'editor_config.json');
    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            return res.json(config);
        }
        res.json({ theme: 'dark', fontSize: '14px' });
    } catch (err) {
        console.error('Config error:', err);
        res.json({ theme: 'dark', fontSize: '14px' });
    }
});

app.post('/save-config', (req, res) => {
    try {
        const configPath = path.join(UPLOAD_DIR, 'editor_config.json');
        fs.writeFileSync(configPath, JSON.stringify(req.body), 'utf8');
        res.json({ success: true });
    } catch (err) {
        console.error('Save config error:', err);
        res.status(500).json({ error: 'Failed to save config' });
    }
});

app.post('/create-folder', (req, res) => {
    const root = sanitizePath(req.body.root || '');
    const folder = req.body.folder?.trim();
    
    if (!folder) {
        return res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
    }

    const newFolderPath = path.join(UPLOAD_DIR, root, folder);
    let finalFolderPath = newFolderPath;
    let counter = 1;
    
    while (fs.existsSync(finalFolderPath)) {
        finalFolderPath = path.join(UPLOAD_DIR, root, `${folder} (${counter++})`);
    }

    fs.mkdir(finalFolderPath, err => {
        if (err) {
            console.error('Create folder error:', err);
        }
        res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
    });
});

app.post('/create-file', (req, res) => {
    const root = sanitizePath(req.body.root || '');
    let filename = req.body.filename?.trim();
    const fileType = req.body.fileType || '.txt';
    
    if (!filename) {
        return res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
    }

    // Dodaj rozszerzenie jeśli nie ma
    if (!filename.endsWith(fileType)) {
        filename += fileType;
    }

    const newFilePath = path.join(UPLOAD_DIR, root, filename);
    let finalFilePath = newFilePath;
    let counter = 1;
    
    while (fs.existsSync(finalFilePath)) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        finalFilePath = path.join(UPLOAD_DIR, root, `${base} (${counter++})${ext}`);
    }

    // Domyślna zawartość w zależności od typu pliku
    let content = '';
    switch (fileType) {
        case '.js':
            content = `// ${filename}\n\nfunction init() {\n    console.log('Hello world');\n}\n\ninit();`;
            break;
        case '.css':
            content = `/* ${filename} */\n\nbody {\n    margin: 0;\n    padding: 0;\n}`;
            break;
        case '.html':
            content = `<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <title>${path.basename(filename, '.html')}</title>\n</head>\n<body>\n    \n</body>\n</html>`;
            break;
        case '.json':
            content = `{\n    "name": "${path.basename(filename, '.json')}",\n    "version": "1.0.0"\n}`;
            break;
        default: // .txt i inne
            content = `${filename}\nCreated on ${new Date().toLocaleString()}`;
    }

    fs.writeFile(finalFilePath, content, err => {
        if (err) {
            console.error('Create file error:', err);
        }
        res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
    });
});

app.post('/rename-current', (req, res) => {
    try {
        const currentFullPath = sanitizePath(req.body.currentPath || '');
        const oldName = req.body.oldName?.trim();
        let newName = req.body.newName?.trim();

        if (!oldName || !newName) {
            return res.redirect(`/filemanager?root=${encodeURIComponent(currentFullPath)}`);
        }

        // Usuń duplikaty
        newName = newName.replace(/\s*\(\d+\)$/, '');

        const oldPath = path.join(UPLOAD_DIR, currentFullPath);
        
        if (!fs.existsSync(oldPath)) {
            return res.redirect(`/filemanager?root=${encodeURIComponent(currentFullPath)}`);
        }

        // nowa sciezka

        const pathParts = currentFullPath.split('/');
        pathParts[pathParts.length - 1] = newName;
        let newFullPath = pathParts.join('/');
        let newPath = path.join(UPLOAD_DIR, newFullPath);

        let counter = 1;
        while (fs.existsSync(newPath) && newPath !== oldPath) {
            newFullPath = [...pathParts.slice(0, -1), `${newName} (${counter++})`].join('/');
            newPath = path.join(UPLOAD_DIR, newFullPath);
        }

        fs.rename(oldPath, newPath, err => {
            if (err) {
                console.error('Rename current folder error:', err);
                return res.redirect(`/filemanager?root=${encodeURIComponent(currentFullPath)}`);
            }
            
            const items = fs.readdirSync(newPath, { withFileTypes: true });
            
            const folders = items.filter(item => item.isDirectory())
                             .map(item => ({
                                 name: item.name,
                                 path: path.join(newFullPath, item.name).replace(/\\/g, '/')
                             }));
            
            const files = items.filter(item => item.isFile())
                           .map(item => ({
                               name: item.name,
                               path: path.join(newFullPath, item.name).replace(/\\/g, '/')
                           }));

            const breadcrumbs = buildBreadcrumbs(newFullPath);
            
            // render nowa nazwa
            res.render('filemanager', {
                folders,
                files,
                currentPath: newFullPath,
                breadcrumbs,
                hasParent: newFullPath !== '',
                parentPath: path.dirname(newFullPath).replace(/\\/g, '/'),
                currentDirName: path.basename(newFullPath) || ''
            });
        });
    } catch (err) {
        console.error('Rename current error:', err);
        res.status(500).render('error', { message: 'Internal server error' });
    }
});

app.get('/download-zip', (req, res) => {
    const root = sanitizePath(req.query.root || '');
    const name = req.query.name;

    if (!name) {
        return res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
    }

    const folderPath = path.join(UPLOAD_DIR, root, name);
    const archiveName = `${name}.zip`;

    if (!fs.existsSync(folderPath)) {
        return res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
    }

    const archive = archiver('zip', {
        zlib: { level: 9 }
    });

    archive.on('error', err => {
        console.error('Zip error:', err);
        res.status(500).send('Error creating zip file');
    });

    res.attachment(archiveName);
    archive.pipe(res);
    archive.directory(folderPath, false);
    archive.finalize();
});

app.post('/upload', (req, res) => {
    const root = sanitizePath(req.query.root || '');
    const form = new formidable.IncomingForm();

    form.uploadDir = path.join(UPLOAD_DIR, root);
    form.keepExtensions = true;
    form.multiples = true;

    form.parse(req, (err, fields, files) => {
        if (err) {
            console.error('Upload error:', err);
            return res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
        }

        const uploadedFiles = Array.isArray(files.file) ? files.file : [files.file];
        let processed = 0;

        uploadedFiles.forEach(uploadedFile => {
            if (!uploadedFile) return;

            let newName = uploadedFile.originalFilename;
            let counter = 1;
            let newPath = path.join(UPLOAD_DIR, root, newName);
            
            while (fs.existsSync(newPath)) {
                const ext = path.extname(newName);
                const base = path.basename(newName, ext);
                newName = `${base} (${counter++})${ext}`;
                newPath = path.join(UPLOAD_DIR, root, newName);
            }

            const oldPath = uploadedFile.filepath;

            fs.rename(oldPath, newPath, err => {
                if (err) console.error('File move error:', err);
                processed++;
                
                if (processed === uploadedFiles.length) {
                    res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
                }
            });
        });
    });
});

app.get('/delete', (req, res) => {
    const root = sanitizePath(req.query.root || '');
    const name = req.query.name;

    if (!name) {
        return res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
    }

    const targetPath = path.join(UPLOAD_DIR, root, name);

    fs.stat(targetPath, (err, stats) => {
        if (err) {
            console.error('Delete stat error:', err);
            return res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
        }

        const deleteOperation = stats.isDirectory() 
            ? fs.rm.bind(null, targetPath, { recursive: true, force: true })
            : fs.unlink.bind(null, targetPath);

        deleteOperation(err => {
            if (err) console.error('Delete error:', err);
            res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
        });
    });
});

app.get('/download', (req, res) => {
    const root = sanitizePath(req.query.root || '');
    const name = req.query.name;

    if (!name) {
        return res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
    }

    const filePath = path.join(UPLOAD_DIR, root, name);

    res.download(filePath, err => {
        if (err) {
            console.error('Download error:', err);
            res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
        }
    });
});

app.get('/download-zip', (req, res) => {
    const root = sanitizePath(req.query.root || '');
    const name = req.query.name;

    if (!name) {
        return res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
    }

    const folderPath = path.join(UPLOAD_DIR, root, name);
    const archiveName = `${name}.zip`;

    if (!fs.existsSync(folderPath)) {
        return res.redirect(`/filemanager?root=${encodeURIComponent(root)}`);
    }

    const archive = archiver('zip', {
        zlib: { level: 9 }
    });

    archive.on('error', err => {
        console.error('Zip error:', err);
        res.status(500).send('Error creating zip file');
    });

    res.attachment(archiveName);
    archive.pipe(res);
    archive.directory(folderPath, false);
    archive.finalize();
});

const effects = [
    { name: "grayscale" },
    { name: "invert" },
    { name: "sepia" }
];

app.get('/edit-image', (req, res) => {
    const filePath = req.query.file; // Najpierw deklaracja
    if (!filePath) {
        return res.status(400).send('Brak parametru file');
    }
    
    // Teraz możesz używać filePath
    const sanitizedPath = filePath.replace(/^\/files\//, '');
    const fullPath = path.join(__dirname, 'FILES', sanitizedPath);
    
    if (!fs.existsSync(fullPath)) {
        return res.status(404).send('Plik nie istnieje');
    }

    res.render('image', { file: `/files/${sanitizedPath}` });
});

app.post('/saveimageendpoint', (req, res) => {
    const form = formidable({ multiples: false });
  
    form.parse(req, (err, fields, files) => {
      if (err) {
        console.error('Form parse error:', err);
        return res.status(400).json({ status: 'error', error: 'Form parse failed' });
      }
  
      // 💡 poprawki: użyj .[0], bo to są tablice
      const uploaded = files.blob?.[0];
      const imagePath = fields.path?.[0];
  
      if (!uploaded || !uploaded.filepath) {
        return res.status(400).json({ status: 'error', error: 'No uploaded blob' });
      }
  
      if (!imagePath || typeof imagePath !== 'string') {
        return res.status(400).json({ status: 'error', error: 'Invalid path' });
      }
  
      const destination = path.join(__dirname, imagePath);
  
      fs.rename(uploaded.filepath, destination, (err) => {
        if (err) {
          console.error('Save error:', err);
          return res.status(500).json({ status: 'error', error: 'Could not save image' });
        }
  
        res.json({ status: 'ok' });
      });
    });
  });


  app.post('/save-edited-image', (req, res) => {
    const form = new formidable.IncomingForm();
  
    form.parse(req, (err, fields, files) => {
      if (err) {
        console.error('Błąd parsowania formularza:', err);
        return res.status(500).send('Błąd parsowania formularza');
      }
  
      const originalPath = fields.originalPath;  // np. /files/image.png
      const uploadedFile = files.file;
  
      if (!originalPath || !uploadedFile) {
        return res.status(400).send('Brak pliku lub ścieżki');
      }
  
      // Ścieżka absolutna na serwerze do oryginalnego pliku
      const serverFilePath = path.join(__dirname, 'public', originalPath);
  
      // Nadpisujemy plik
      fs.rename(uploadedFile.filepath, serverFilePath, (err) => {
        if (err) {
          console.error('Błąd zapisu pliku:', err);
          return res.status(500).send('Błąd zapisu pliku');
        }
  
        res.status(200).send('Zapisano');
      });
    });
  });

app.get('/error', (req, res) => {
    res.render('error', { message: 'An error occurred' });
});

// Other filemanager routes (download, delete, etc.) remain the same

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
