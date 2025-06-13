window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const filePath = urlParams.get('file'); // np. /files/moj_obraz.png

    console.log('Loading image from:', filePath); // Debugowanie ścieżki

    if (!filePath) {
        alert('Brak pliku do edycji!');
        return;
    }

    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');
    const cropRect = document.getElementById('cropRect');
    const canvasContainer = document.getElementById('canvasContainer');

    let img = new Image();
    let filters = {
        filter: 'none',
        brightness: 100,
        contrast: 100,
        hue: 0
    };

    let cropMode = false;
    let cropStart = null;
    let cropEnd = null;

    // Funkcja do stosowania filtrów
    function applyFilters() {
        const filterStr = 
            `${filters.filter !== 'none' ? filters.filter + '(1) ' : ''}` +
            `brightness(${filters.brightness}%) ` +
            `contrast(${filters.contrast}%) ` +
            `hue-rotate(${filters.hue}deg)`;
        
        canvas.style.filter = filterStr.trim();
    }

    // Funkcja do skalowania obrazu
    function drawImageScaled() {
        const maxW = 600;
        const maxH = 400;
        let w = img.width;
        let h = img.height;

        let scale = Math.min(maxW / w, maxH / h, 1);
        canvas.width = w * scale;
        canvas.height = h * scale;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        applyFilters();
    }

    // Obsługa błędów ładowania obrazu
    img.onerror = () => {
        console.error('Failed to load image:', filePath);
        alert('Nie można załadować obrazka! Sprawdź konsolę.');
    };

    img.onload = () => {
        drawImageScaled();
    };
    
    img.crossOrigin = 'anonymous';
    img.src = filePath;

    // Obsługa filtrów przyciskami
    document.querySelectorAll('.controls button[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            filters.filter = btn.getAttribute('data-filter');
            applyFilters();
        });
    });

    // Suwaki jasność, kontrast, hue
    document.getElementById('brightness').addEventListener('input', e => {
        filters.brightness = e.target.value;
        applyFilters();
    });
    
    document.getElementById('contrast').addEventListener('input', e => {
        filters.contrast = e.target.value;
        applyFilters();
    });
    
    document.getElementById('hue').addEventListener('input', e => {
        filters.hue = e.target.value;
        applyFilters();
    });

    // Funkcje do przycinania obrazu (crop)
    document.getElementById('cropBtn').addEventListener('click', () => {
        cropMode = !cropMode;
        cropRect.style.display = 'none';
        cropStart = null;
        cropEnd = null;
        canvasContainer.style.cursor = cropMode ? 'crosshair' : 'default';
    });

    canvasContainer.addEventListener('mousedown', (e) => {
        if (!cropMode) return;
        const rect = canvas.getBoundingClientRect();
        cropStart = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        cropRect.style.left = cropStart.x + 'px';
        cropRect.style.top = cropStart.y + 'px';
        cropRect.style.width = '0px';
        cropRect.style.height = '0px';
        cropRect.style.display = 'block';
    });

    canvasContainer.addEventListener('mousemove', (e) => {
        if (!cropMode || !cropStart) return;
        const rect = canvas.getBoundingClientRect();
        cropEnd = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        
        const left = Math.min(cropStart.x, cropEnd.x);
        const top = Math.min(cropStart.y, cropEnd.y);
        const width = Math.abs(cropEnd.x - cropStart.x);
        const height = Math.abs(cropEnd.y - cropStart.y);

        cropRect.style.left = left + 'px';
        cropRect.style.top = top + 'px';
        cropRect.style.width = width + 'px';
        cropRect.style.height = height + 'px';
    });

    canvasContainer.addEventListener('mouseup', (e) => {
        if (!cropMode || !cropStart) return;
        cropMode = false;
        canvasContainer.style.cursor = 'default';

        const scaleX = img.width / canvas.width;
        const scaleY = img.height / canvas.height;

        const left = parseFloat(cropRect.style.left);
        const top = parseFloat(cropRect.style.top);
        const width = parseFloat(cropRect.style.width);
        const height = parseFloat(cropRect.style.height);

        const cropX = Math.round(left * scaleX);
        const cropY = Math.round(top * scaleY);
        const cropW = Math.round(width * scaleX);
        const cropH = Math.round(height * scaleY);

        // Przycinanie obrazu
        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

        cropRect.style.display = 'none';
        const newDataURL = canvas.toDataURL();
        img.src = newDataURL;
    });

    // Funkcja zapisu obrazu
    document.getElementById('saveBtn').addEventListener('click', async () => {
        try {
            // Utwórz tymczasowy canvas do renderowania finalnego obrazu
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            
            // Ustaw wymiary tymczasowego canvas
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            
            // Zastosuj wszystkie filtry na tymczasowym canvas
            tempCtx.filter = canvas.style.filter;
            tempCtx.drawImage(canvas, 0, 0);
            
            // Konwertuj do blob z zachowaniem jakości
            const blob = await new Promise((resolve) => {
                tempCanvas.toBlob(resolve, 'image/png', 0.95);
            });
    
            if (!blob) {
                throw new Error('Nie udało się wygenerować obrazu');
            }
    
            // Przygotuj dane do wysłania
            const formData = new FormData();
            formData.append('file', blob, 'edited_' + filePath.split('/').pop());
            formData.append('path', filePath);
    
            // Wyślij żądanie
            const response = await fetch('/save-image', {
                method: 'POST',
                body: formData
            });
    
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Błąd serwera: ${response.status} ${errorText}`);
            }
    
            const result = await response.json();
            if (result.success) {
                alert('Plik został pomyślnie zapisany ze wszystkimi zmianami!');
                // Odśwież obraz (opcjonalnie)
                img.src = URL.createObjectURL(blob);
            } else {
                throw new Error(result.error || 'Nieznany błąd serwera');
            }
        } catch (err) {
            console.error('Błąd podczas zapisu:', err);
            alert('Błąd podczas zapisu: ' + err.message);
        }
    });
});
