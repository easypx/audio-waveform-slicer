import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7.7/dist/wavesurfer.esm.js'
import RegionsPlugin from 'https://unpkg.com/wavesurfer.js@7.7/dist/plugins/regions.esm.js'
import TimelinePlugin from 'https://unpkg.com/wavesurfer.js@7.7/dist/plugins/timeline.esm.js'
//import {JSZip} from 'https://unpkg.com/@progress/jszip-esm@1.0.4/dist/jszip-esm2015.js' //fehler
//import JSZip from 'https://cdn.jsdelivr.net/npm/@progress/jszip-esm@1.0.4/dist/jszip.min.js' //fehler
import JSZip from 'https://unpkg.com' //browser hoert nicht auf zu laden



// 1. Wavesurfer-Instanz erstellen
const ws = WaveSurfer.create({
    container: '#waveform',
    waveColor: '#4F4A85',
    progressColor: '#383351',
    responsive: true,
    // WICHTIG: Fügen Sie diese Zeile hier ein!
    sampleRate: 44100
});

// Das importierte Modul direkt verwenden
const wsTimeline = ws.registerPlugin(
    // WICHTIG: Nutzen Sie direkt den Namen aus Ihrem import-Befehl!
    TimelinePlugin.create({
        // Optional: Falls Sie die Leiste automatisch einfügen lassen möchten,
        // können Sie den Container-Parameter hier auch komplett weglassen.
        container: '#wave-timeline', // Wo die Skala gezeichnet werden soll
        // HIER DIE ÄNDERUNG: "Callback" am Ende hinzufügen!
        formatTimeCallback: (seconds) => {
            const minutes = Math.floor(seconds / 60)
            const secs = Math.floor(seconds % 60)
            return `${minutes}m ${secs < 10 ? '0' : ''}${secs}s`
        },
        timeInterval: 5, // Primäre Zeitstriche alle 5 Sekunden (wird bei Zoom autom. angepasst)
        primaryLabelInterval: 10, // Textbeschriftung alle 10 Sekunden
        style: {
            color: '#666', // Textfarbe der Zahlen
            fontSize: '12px'
        }
    })
)


// 2. Regions-Plugin aktivieren (für die Markierungen)
const wsRegions = ws.registerPlugin(RegionsPlugin.create());

// 3. Datei-Upload verarbeiten
document.getElementById('audio-file').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        const fileUrl = URL.createObjectURL(file);
        ws.load(fileUrl);
        document.getElementById('btn-export').disabled = false;
    }
});

// 4. Erlauben, Bereiche mit der Maus zu ziehen
ws.on('decode', () => {
    wsRegions.enableDragSelection({
        color: 'rgba(0, 255, 0, 0.15)' // Transparentes Grün für markierte Bereiche
    });
});

// Optional: Zeige die Zeiten an, wenn eine Region erstellt wurde
wsRegions.on('region-created', (region) => {
    console.log(`Neue Region erstellt: Start ${region.start}s - Ende ${region.end}s`);
});

// Hilfsfunktion: Wandelt einen AudioBuffer in eine WAV-Datei um (im Browser-Speicher)
// Da Browser Rohdaten nicht direkt als MP3 speichern können, ist WAV der stabilste Weg ohne Zusatzbibliotheken.
function bufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels,
        length = buffer.length * numOfChan * 2 + 44,
        bufferArr = new ArrayBuffer(length),
        view = new DataView(bufferArr),
        channels = [];
    let sample = 0;
    let i = 0;
    let offset = 0;
    let pos = 0;

    // WAV-Header schreiben
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }

    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // Dateigröße - 8
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16);         // Chunk-Größe
    setUint16(1);          // Audio Format (PCM)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // Byte Rate
    setUint16(numOfChan * 2);                     // Block Align
    setUint16(16);                                // Bits per Sample
    setUint32(0x61746164); // "data" chunk
    setUint32(buffer.length * numOfChan * 2);     // Chunk-Größe Daten

    // Audiodaten schreiben
    for (i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
    while (pos < length) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }
    return new Blob([bufferArr], { type: 'audio/wav' });
}

const exportBtn = document.getElementById('btn-export')
// Der neue Export-Button Listener
exportBtn.addEventListener('click', async () => {
    // 1. Alle Regionen holen und von links nach rechts (Startzeit) sortieren
    const regions = wsRegions.getRegions().sort((a, b) => a.start - b.start);

    if (regions.length === 0) {
        alert("Bitte markiere zuerst mindestens einen Bereich!");
        return;
    }

    const originalBuffer = ws.getDecodedData();
    const sampleRate = originalBuffer.sampleRate;
    //console.log(sampleRate);
    const numChannels = originalBuffer.numberOfChannels;

    // 2. Gesamtlänge (in Samples) aller Regionen berechnen
    let totalSamples = 0;
    const regionRanges = regions.map(r => {
        const startSample = Math.floor(r.start * sampleRate);
        const endSample = Math.floor(r.end * sampleRate);
        const durationSamples = endSample - startSample;
        totalSamples += durationSamples;
        return { startSample, durationSamples };
    });

    // 3. Einen neuen, leeren AudioBuffer für den zusammengefügten Song erstellen
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const combinedBuffer = ctx.createBuffer(numChannels, totalSamples, sampleRate);

    // 4. Daten Kanal für Kanal hintereinanderkopieren
    for (let channel = 0; channel < numChannels; channel++) {
        const originalData = originalBuffer.getChannelData(channel);
        const combinedData = combinedBuffer.getChannelData(channel);

        let currentOffset = 0; // Bestimmt, wo im NEUEN Buffer geschrieben wird

        for (const range of regionRanges) {
            // HIER WAR DER FEHLER: Wir müssen beim Kopieren im originalData-Array 
            // exakt beim 'startSample' der jeweiligen Region anfangen!
            for (let i = 0; i < range.durationSamples; i++) {
                combinedData[currentOffset + i] = originalData[range.startSample + i];
            }
            // Verschiebe die Schreib-Position für die nächste Region nach rechts
            currentOffset += range.durationSamples;
        }
    }


    // ... (Schritte 1 bis 4 zum Zusammenfügen der Kanäle bleiben exakt gleich!) ...

    // 5. Format prüfen und entsprechende Datei generieren
    const formatSelect = document.getElementById('format-select');
    const selectedFormat = formatSelect.value;

    let audioBlob;
    let filename;

    console.log(`Generiere Export im Format: ${selectedFormat.toUpperCase()}...`);

    if (selectedFormat === 'mp3') {
        audioBlob = bufferToMp3(combinedBuffer, 128); // 128 kbps Standard-Bitrate
        filename = 'zusammengeschnittene-samples.mp3';
    } else {
        audioBlob = bufferToWav(combinedBuffer);
        filename = 'zusammengeschnittene-samples.wav';
    }

    // 6. Download starten
    const downloadUrl = URL.createObjectURL(audioBlob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl); // Speicherbereinigung im Browser

});

// Funktion, die einen AudioBuffer in ein MP3-Blob umwandelt
function bufferToMp3(buffer, bitrate = 128) {
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;

    // Lamejs initialisieren (Kanäle, Sample-Rate, Bitrate)
    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitrate);
    const mp3Data = [];

    // Audiodaten für lamejs vorbereiten (Float32 zu Int16)
    const sampleBlockSize = 1152;
    const leftData = buffer.getChannelData(0);
    const rightData = channels > 1 ? buffer.getChannelData(1) : new Float32Array(leftData.length);

    for (let i = 0; i < leftData.length; i += sampleBlockSize) {
        const leftChunk = new Int16Array(Math.min(sampleBlockSize, leftData.length - i));
        const rightChunk = new Int16Array(Math.min(sampleBlockSize, rightData.length - i));

        // Konvertiere die Amplitudenwerte
        for (let j = 0; j < leftChunk.length; j++) {
            let leftSample = leftData[i + j];
            let rightSample = rightData[i + j];

            // Werte clippen und in Int16 transformieren
            leftChunk[j] = leftSample < 0 ? leftSample * 0x8000 : leftSample * 0x7FFF;
            rightChunk[j] = rightSample < 0 ? rightSample * 0x8000 : rightSample * 0x7FFF;
        }

        // Encodieren (für Stereo nutzt man encodeBuffer)
        let mp3buf;
        if (channels === 1) {
            mp3buf = mp3encoder.encodeBuffer(leftChunk);
        } else {
            mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
        }

        if (mp3buf.length > 0) {
            mp3Data.push(new Uint8Array(mp3buf));
        }
    }

    // Encoder sauber beenden und letzten Puffer leeren
    const endBuf = mp3encoder.flush();
    if (endBuf.length > 0) {
        mp3Data.push(new Uint8Array(endBuf));
    }

    // Gib das fertige MP3 als Datei-Blob zurück
    return new Blob(mp3Data, { type: 'audio/mp3' });
}

// --- PLAY / PAUSE BUTTON ---
const playBtn = document.getElementById('btn-play')
playBtn.addEventListener('click', () => ws.playPause())
// Sobald die Audiodatei vollständig geladen und bereit ist:

ws.on('ready', () => {
    playBtn.disabled = false;
})

// --- REGIONS-LISTE AKTUALISIEREN ---
const listContainer = document.getElementById('regions-list')

function updateRegionsList() {
    const listContainer = document.getElementById('regions-list')
    if (!listContainer) return

    // Sicherstellen, dass die Liste wirklich komplett leer ist
    while (listContainer.firstChild) {
        listContainer.removeChild(listContainer.firstChild)
    }

    // Alle echten Regionen aus WaveSurfer holen
    const regions = wsRegions.getRegions()

    regions.forEach((region, index) => {
        const li = document.createElement('li')

        const start = region.start.toFixed(1)
        const end = region.end.toFixed(1)

        li.innerHTML = `
      <strong>Region #${index + 1}</strong>: ${start}s bis ${end}s 
      <button class="play-region-btn">Abspielen</button>
      <button class="delete-region-btn" style="color: red; margin-left: 10px;">Löschen</button>
    `

        //li.querySelector('.play-region-btn').addEventListener('click', () => region.play())
        // In Ihrer updateRegionsList() Funktion:
        li.querySelector('.play-region-btn').addEventListener('click', () => {
            activePlayingRegion = region // <-- Merken, dass wir DIESE Region isoliert abspielen
            region.play()
        })

        li.querySelector('.delete-region-btn').addEventListener('click', () => region.remove())

        listContainer.appendChild(li)
    })
}


// --- WAVESURFER EVENTS (Präzise getrennt) ---

// WICHTIG: Beim ersten Erstellen prüfen wir, ob die Region valide ist.
wsRegions.on('region-created', (region) => {
    // Verhindert leere "Geister"-Regionen, die durch einen einfachen Klick (ohne Ziehen) entstehen
    if (region.start === region.end) {
        region.remove()
        return
    }
    updateRegionsList()
})

// Aktualisiert die Liste erst, wenn das Ziehen/Größenändern BEENDET ist
wsRegions.on('region-updated', updateRegionsList)
wsRegions.on('region-removed', updateRegionsList)

// 2. Aktivieren Sie die Maus-Auswahl exakt EINMAL hier unten
/*wsRegions.enableDragSelection({
  color: 'rgba(0, 255, 0, 0.1)'
})*/

// Variable, um zu merken, ob wir eine Region gezielt abspielen 
// (verhindert Konflikte beim normalen Abspielen)
let activePlayingRegion = null

// Wenn eine Region über den "Abspielen"-Button gestartet wird
wsRegions.on('region-clicked', (region, e) => {
    // Verhindert das Standardverhalten, falls nötig
    e.stopPropagation()
    activePlayingRegion = region
    region.play()
})

// Auch beim Klick auf den Listen-Button merken wir uns die aktive Region
// Passen Sie Ihre updateRegionsList() beim Play-Button-Event an:
// li.querySelector('.play-region-btn').addEventListener('click', () => {
//   activePlayingRegion = region
//   region.play()
// })

// Laufende Überprüfung der Abspielposition
// Die korrigierte Stopp-Logik gegen Endlosschleifen
ws.on('timeupdate', (currentTime) => {
    if (activePlayingRegion) {
        // Nur prüfen und stoppen, wenn das Audio auch WIRKLICH läuft
        if (currentTime >= activePlayingRegion.end && ws.isPlaying()) {
            ws.pause() // Zuerst pausieren!

            // activePlayingRegion SOFORT auf null setzen, 
            // BEVOR setTime aufgerufen wird, um die Schleife zu brechen!
            const targetEnd = activePlayingRegion.end
            activePlayingRegion = null

            ws.setTime(targetEnd) // Nadel sicher am Ende parken
        }
    }



    // Methode 2: Allgemeiner Stopp (Egal wie abgespielt wurde):
    // Wenn die Nadel das Ende IRGENDEINER Region erreicht, stoppen
    const regions = wsRegions.getRegions()
    regions.forEach(region => {
        // Toleranzbereich von 0.1 Sekunden, um verlässliches Stoppen zu garantieren
        if (currentTime >= region.end - 0.05 && currentTime <= region.end + 0.05) {
            // Nur stoppen, wenn die Nadel vorher auch wirklich in der Region war
            if (ws.isPlaying()) {
                ws.pause()
                ws.setTime(region.end)
            }
        }
    })
})

// Wenn der Nutzer manuell irgendwo hinklickt, setzen wir den Fokus zurück
ws.on('interaction', () => {
    activePlayingRegion = null
})

// Function to extract a specific region into its own AudioBuffer
function extractRegionBuffer(region, originalBuffer) {
    const sampleRate = originalBuffer.sampleRate;
    const numChannels = originalBuffer.numberOfChannels;

    const startSample = Math.floor(region.start * sampleRate);
    const endSample = Math.floor(region.end * sampleRate);
    const durationSamples = endSample - startSample;

    // Create a temporary AudioContext to generate the new buffer
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
    const regionBuffer = ctx.createBuffer(numChannels, durationSamples, sampleRate);

    // Copy the PCM data for each channel
    for (let channel = 0; channel < numChannels; channel++) {
        const originalData = originalBuffer.getChannelData(channel);
        const regionData = regionBuffer.getChannelData(channel);

        for (let i = 0; i < durationSamples; i++) {
            regionData[i] = originalData[startSample + i];
        }
    }
    return regionBuffer;
}

// --- ZIP EXPORT TRIGGER ---

const exportBtnZip = document.getElementById('btn-export-zip')
exportBtnZip.addEventListener('click', async () => {
    // 1. Get and sort regions
    const regions = wsRegions.getRegions().sort((a, b) => a.start - b.start);

    if (regions.length === 0) {
        alert("Bitte markiere zuerst mindestens einen Bereich!");
        return;
    }

    const originalBuffer = ws.getDecodedData();
    
    // 2. Initialize JSZip
    const zip = new JSZip();

    // 3. Loop through all regions and add them to the ZIP
    regions.forEach((region, index) => {
        // Extract the audio buffer for just this region
        const regionBuffer = extractRegionBuffer(region, originalBuffer);
        
        // Convert it to a WAV Blob using your existing function
        const wavBlob = bufferToWav(regionBuffer);

        // Name the file dynamically based on its order and timestamps
        const startTime = region.start.toFixed(1);
        const endTime = region.end.toFixed(1);
        const fileName = `region_${index + 1}_(${startTime}s-${endTime}s).wav`;

        // Add the file to the ZIP archive
        zip.file(fileName, wavBlob);
    });

    // 4. Generate the ZIP file asynchronous and trigger the download
    try {
        const zipBlob = await zip.generateAsync({ type: "blob" });
        
        // Create a temporary download link
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(zipBlob);
        downloadLink.download = "extracted_regions.zip";
        
        // Trigger download and clean up
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(downloadLink.href);
    } catch (error) {
        console.error("Fehler beim Erstellen der ZIP-Datei:", error);
        alert("Das ZIP-Archiv konnte nicht erstellt werden.");
    }
});
