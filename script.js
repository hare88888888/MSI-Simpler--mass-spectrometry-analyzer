// Global variables
let uploadedImages = []; // Store multiple uploaded images with their analysis results
let currentImageIndex = 0; // Current displayed image index
let canvas = document.getElementById('image-canvas');
let ctx = canvas.getContext('2d');
let intensityLabels = document.getElementById('intensity-labels');
let uploadProgress = document.getElementById('upload-progress');
let uploadStatus = document.getElementById('upload-status');
let intensityMin = document.getElementById('intensity-min');
let intensityMax = document.getElementById('intensity-max');
let colorBar = document.getElementById('color-bar');
let resultsBody = document.getElementById('results-body');

// Region data
let currentRegion = null;
let isDrawing = false;

// Sample tray detection - stores the detected tray region for each image
let sampleTrayRegions = new Map();

/**
 * Detect sample tray region from the image
 * The sample tray is the black rectangular region in the center of the image
 * @param {ImageData} imageData - The full image data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Object} - {x, y, width, height} of the sample tray region
 */
function detectSampleTray(imageData, width, height) {
    const data = imageData.data;
    const threshold = 30; // Threshold to distinguish black (tray) from gray (background)
    
    // Find the bounding box of the black region
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let foundBlack = false;
    
    // Scan the image to find the black region boundaries
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            // Check if pixel is dark (part of the black tray)
            // The tray should be very dark (near black)
            const brightness = (r + g + b) / 3;
            
            if (brightness < threshold) {
                foundBlack = true;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }
    
    if (!foundBlack) {
        // If no black region found, return the full image
        return { x: 0, y: 0, width: width, height: height };
    }
    
    // Add some padding to ensure we capture the full tray
    const padding = 5;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(width - 1, maxX + padding);
    maxY = Math.min(height - 1, maxY + padding);
    
    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
}

// Initialization
function init() {
    // Bind events
    document.getElementById('image-upload').addEventListener('change', handleImageUpload);
    document.getElementById('save-color-scheme').addEventListener('click', saveColorScheme);
    document.getElementById('load-color-scheme').addEventListener('click', loadColorScheme);
    document.getElementById('upload-color-bar').addEventListener('click', uploadColorBar);
    document.getElementById('color-bar-file').addEventListener('change', handleColorBarUpload);
    document.getElementById('auto-analyze').addEventListener('click', autoAnalyze);
    document.getElementById('manual-selection').addEventListener('click', startManualSelection);
    document.getElementById('calculate-intensity').addEventListener('click', calculateIntensity);
    document.getElementById('export-results').addEventListener('click', exportResults);
    document.getElementById('export-excel').addEventListener('click', exportExcel);
    document.getElementById('clear-all').addEventListener('click', clearAllAnalysis);
    document.getElementById('prev-image').addEventListener('click', previousImage);
    document.getElementById('next-image').addEventListener('click', nextImage);
    
    // Color bar input change events - save values to current image
    intensityMin.addEventListener('change', function() {
        if (uploadedImages.length > 0) {
            const currentImage = uploadedImages[currentImageIndex];
            currentImage.minimumIntensity = parseInt(this.value) || 0;
            console.log(`Updated minimum intensity for ${currentImage.name}: ${currentImage.minimumIntensity}`);
        }
    });
    
    intensityMax.addEventListener('change', function() {
        if (uploadedImages.length > 0) {
            const currentImage = uploadedImages[currentImageIndex];
            currentImage.maximumIntensity = parseInt(this.value) || 353515;
            console.log(`Updated maximum intensity for ${currentImage.name}: ${currentImage.maximumIntensity}`);
        }
    });
    
    // Bind summary table events
    bindSummaryEvents();
    
    // Canvas events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDrawing);
    canvas.addEventListener('mouseout', endDrawing);
}

// Detect actual file type
function detectFileType(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const header = new Uint8Array(e.target.result);
            const headerHex = Array.from(header.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
            
            // PNG: 89504e47
            if (headerHex === '89504e47') {
                resolve('PNG');
            }
            // JPEG: ffd8ff
            else if (headerHex.startsWith('ffd8ff')) {
                resolve('JPEG');
            }
            // TIFF: 4949 (II - little endian) or 4d4d (MM - big endian)
            else if (headerHex.startsWith('4949') || headerHex.startsWith('4d4d')) {
                resolve('TIFF');
            }
            // GIF: 47494638
            else if (headerHex.startsWith('47494638')) {
                resolve('GIF');
            }
            // BMP: 424d
            else if (headerHex.startsWith('424d')) {
                resolve('BMP');
            }
            else {
                resolve('UNKNOWN');
            }
        };
        reader.onerror = () => reject(new Error('Unable to read file header'));
        reader.readAsArrayBuffer(file.slice(0, 8));
    });
}

// Handle image upload - supports multiple files and formats
async function handleImageUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    // Validate file format (extension check)
    const validExtensions = ['.tif', '.tiff', '.png', '.jpg', '.jpeg', '.gif', '.bmp'];
    const invalidFiles = files.filter(file => {
        const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
        return !validExtensions.includes(ext);
    });
    
    if (invalidFiles.length > 0) {
        uploadStatus.textContent = `Error: The following file formats are not supported: ${invalidFiles.map(f => f.name).join(', ')}`;
        uploadStatus.className = 'status error';
        return;
    }
    
    uploadStatus.textContent = `Preparing to upload ${files.length} files...`;
    uploadStatus.className = 'status';
    
    // Clear previous data
    uploadedImages = [];
    updateResultsTable();
    clearIntensityLabels();
    
    const results = {
        success: [],
        failed: []
    };
    
    // Process files one by one
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progress = ((i + 1) / files.length) * 100;
        
        uploadStatus.textContent = `Processing: ${file.name} (${i + 1}/${files.length})`;
        uploadProgress.querySelector('.progress-fill').style.width = progress + '%';
        
        try {
            // Detect actual file type
            const fileType = await detectFileType(file);
            console.log(`Actual type of file ${file.name}: ${fileType}`);
            
            let imageData;
            
            // Choose processing method based on file type
            if (fileType === 'TIFF') {
                imageData = await processTIFF(file);
            } else if (['PNG', 'JPEG', 'GIF', 'BMP'].includes(fileType)) {
                imageData = await processStandardImage(file);
            } else {
                // Try to process as standard image
                try {
                    imageData = await processStandardImage(file);
                } catch (e) {
                    // If that fails, try to process as TIFF
                    imageData = await processTIFF(file);
                }
            }
            
            uploadedImages.push({
                name: file.name,
                canvas: imageData.canvas,
                width: imageData.width,
                height: imageData.height,
                size: file.size,
                type: fileType,
                regions: [], // Store regions for this image
                results: [], // Store analysis results for this image
                maximumIntensity: parseInt(intensityMax.value) || 353515, // Store maximum intensity for this image
                minimumIntensity: parseInt(intensityMin.value) || 0 // Store minimum intensity for this image
            });
            results.success.push({name: file.name, type: fileType});
        } catch (error) {
            results.failed.push({
                name: file.name,
                error: error.message
            });
            console.error(`Failed to process file ${file.name}:`, error);
        }
    }
    
    // Display final results
    if (results.success.length > 0) {
        currentImageIndex = 0;
        displayCurrentImage();
        
        let statusMsg = `Successfully uploaded ${results.success.length} files`;
        if (results.failed.length > 0) {
            statusMsg += `, ${results.failed.length} failed`;
        }
        uploadStatus.textContent = statusMsg;
        uploadStatus.className = 'status success';
        uploadProgress.querySelector('.progress-fill').style.width = '100%';
        
        // If there are failed files, show detailed information
        if (results.failed.length > 0) {
            console.error('Failed to upload files:', results.failed);
            setTimeout(() => {
                alert(`The following files failed to upload:\n${results.failed.map(f => `${f.name}: ${f.error}`).join('\n')}`);
            }, 100);
        }
    } else {
        uploadStatus.textContent = `All files failed to upload`;
        uploadStatus.className = 'status error';
        alert(`Upload failed:\n${results.failed.map(f => `${f.name}: ${f.error}`).join('\n')}`);
    }
}

// Process standard image files (PNG, JPEG, GIF, BMP, etc.)
function processStandardImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const img = new Image();
            
            img.onload = function() {
                try {
                    // Create canvas and draw image
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    
                    const result = {
                        canvas: canvas,
                        width: img.width,
                        height: img.height
                    };
                    
                    resolve(result);
                } catch (error) {
                    reject(new Error(`Failed to process image: ${error.message}`));
                }
            };
            
            img.onerror = function() {
                reject(new Error('Unable to load image'));
            };
            
            img.src = e.target.result;
        };
        
        reader.onerror = function() {
            reject(new Error('Failed to read file'));
        };
        
        reader.readAsDataURL(file);
    });
}

// Process single TIFF file
function processTIFF(file) {
    return new Promise((resolve, reject) => {
        console.log(`Starting to process TIFF file: ${file.name}, size: ${file.size} bytes`);
        
        // Check file size
        if (file.size > 50 * 1024 * 1024) { // 50MB limit
            console.warn(`File ${file.name} is large (${(file.size/1024/1024).toFixed(2)} MB)`);
            // For large files, try to use chunked processing
        }
        
        // Check browser memory limit
        if (typeof navigator !== 'undefined' && navigator.deviceMemory) {
            const deviceMemory = navigator.deviceMemory; // GB
            if (deviceMemory < 4 && file.size > 20 * 1024 * 1024) {
                console.warn(`Device memory is low (${deviceMemory}GB), may not be able to process large files`);
            }
        }
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            console.log(`File ${file.name} read completed, size: ${e.target.result.byteLength} bytes`);
            
            try {
                const buffer = e.target.result;
                console.log(`Creating TIFF object...`);
                
                // Try to create TIFF object
                const tiff = new Tiff({buffer: buffer});
                console.log(`TIFF object created successfully`);
                
                // Get TIFF information
                console.log(`TIFF page count: ${tiff.countDirectory()}`);
                
                // Try to convert to Canvas
                console.log(`Attempting to convert to Canvas...`);
                
                // Try different Canvas conversion options
                let tiffCanvas;
                try {
                    // Try default conversion
                    tiffCanvas = tiff.toCanvas();
                } catch (canvasError) {
                    console.warn(`Default Canvas conversion failed: ${canvasError.message}`);
                    // Try specifying DPI
                    try {
                        tiffCanvas = tiff.toCanvas({dpi: 72});
                        console.log(`Successfully converted using DPI 72`);
                    } catch (dpiError) {
                        console.warn(`DPI conversion also failed: ${dpiError.message}`);
                        // Try scaling down
                        try {
                            const width = tiff.width() || 1000;
                            const height = tiff.height() || 1000;
                            const scale = Math.min(1, 2000 / Math.max(width, height));
                            tiffCanvas = tiff.toCanvas({scale: scale});
                            console.log(`Successfully converted using scale ${scale.toFixed(2)}`);
                        } catch (scaleError) {
                            throw new Error(`All Canvas conversion attempts failed: ${scaleError.message}`);
                        }
                    }
                }
                
                if (!tiffCanvas) {
                    throw new Error('Unable to parse TIFF image to Canvas');
                }
                
                console.log(`Canvas created successfully, size: ${tiffCanvas.width}x${tiffCanvas.height}`);
                
                const result = {
                    canvas: tiffCanvas,
                    width: tiffCanvas.width,
                    height: tiffCanvas.height
                };
                
                tiff.close();
                console.log(`TIFF processing completed: ${file.name}`);
                resolve(result);
            } catch (error) {
                console.error(`TIFF parsing error: ${error.message}`, error);
                // Try to process as standard image
                console.log(`Attempting to process as standard image...`);
                processStandardImage(file)
                    .then(result => {
                        console.log(`Successfully processed as standard image: ${file.name}`);
                        resolve(result);
                    })
                    .catch(standardError => {
                        console.error(`Standard image processing also failed: ${standardError.message}`);
                        reject(new Error(`Parsing failed: ${error.message} (Standard image processing also failed: ${standardError.message})`));
                    });
            }
        };
        
        reader.onerror = function() {
            console.error(`File read error: ${file.name}`);
            reject(new Error('Failed to read file'));
        };
        
        reader.onprogress = function(e) {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                console.log(`File read progress: ${file.name} - ${percent}%`);
                // Update UI progress
                if (uploadProgress) {
                    uploadProgress.querySelector('.progress-fill').style.width = percent + '%';
                }
            }
        };
        
        console.log(`Starting to read file: ${file.name}`);
        reader.readAsArrayBuffer(file);
    });
}

// Display currently selected image
function displayCurrentImage() {
    if (uploadedImages.length === 0) return;
    
    const imageData = uploadedImages[currentImageIndex];
    
    // Set canvas size
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    
    // Draw image
    ctx.drawImage(imageData.canvas, 0, 0);
    
    // Update color bar inputs with current image's values
    intensityMin.value = imageData.minimumIntensity || 0;
    intensityMax.value = imageData.maximumIntensity || 353515;
    
    // Draw regions for current image
    if (imageData.regions && imageData.regions.length > 0) {
        imageData.regions.forEach(region => drawRegion(region));
        updateResultsTable(imageData.results);
        // Recreate intensity labels
        clearIntensityLabels();
        imageData.results.forEach((result, index) => {
            if (imageData.regions[index]) {
                displayIntensityLabel(imageData.regions[index], result.totalIntensity);
            }
        });
    } else {
        updateResultsTable();
        clearIntensityLabels();
    }
    
    // Update image navigation display
    updateImageNavigation();
}

// Update image navigation display
function updateImageNavigation() {
    const navSection = document.getElementById('image-navigation');
    const counter = document.getElementById('image-counter');
    const imageName = document.getElementById('current-image-name');
    
    if (uploadedImages.length > 0) {
        navSection.style.display = 'block';
        counter.textContent = (currentImageIndex + 1) + ' / ' + uploadedImages.length;
        const currentImage = uploadedImages[currentImageIndex];
        const fileType = currentImage.type || 'Unknown';
        const fileSize = (currentImage.size / 1024).toFixed(1);
        imageName.textContent = `${currentImage.name} (${fileType}, ${fileSize} KB)`;
    } else {
        navSection.style.display = 'none';
    }
}

// Switch to previous image
function previousImage() {
    if (uploadedImages.length === 0) return;
    currentImageIndex = (currentImageIndex - 1 + uploadedImages.length) % uploadedImages.length;
    displayCurrentImage();
}

// Switch to next image
function nextImage() {
    if (uploadedImages.length === 0) return;
    currentImageIndex = (currentImageIndex + 1) % uploadedImages.length;
    displayCurrentImage();
}

// Save color scheme
function saveColorScheme() {
    const scheme = {
        min: parseInt(intensityMin.value) || 0,
        max: parseInt(intensityMax.value) || 353515
    };
    
    localStorage.setItem('colorScheme', JSON.stringify(scheme));
    alert('Color scheme saved successfully!');
}

// Load color scheme
function loadColorScheme() {
    const scheme = localStorage.getItem('colorScheme');
    if (scheme) {
        const parsedScheme = JSON.parse(scheme);
        intensityMin.value = parsedScheme.min;
        intensityMax.value = parsedScheme.max;
        alert('Color scheme loaded successfully!');
    } else {
        alert('No saved color scheme found');
    }
}

// Trigger color bar file selection
function uploadColorBar() {
    document.getElementById('color-bar-file').click();
}

// Handle color bar image upload
function handleColorBarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const colorBarImg = document.getElementById('color-bar');
        colorBarImg.src = e.target.result;
        alert('Color bar image imported successfully!');
    };
    reader.readAsDataURL(file);
    
    // Reset the file input
    event.target.value = '';
}

// Clear all analysis results
function clearAllAnalysis() {
    if (!confirm('Are you sure you want to clear all analysis results? This action cannot be undone.')) {
        return;
    }
    
    // Clear all regions and results for all images
    uploadedImages.forEach(image => {
        image.regions = [];
        image.results = [];
        image.minimumIntensity = null;
        image.maximumIntensity = null;
    });
    
    // Clear summary data
    summaryData = [];
    
    // Clear results table
    resultsBody.innerHTML = '';
    
    // Clear summary table
    const summaryTableBody = document.getElementById('summary-table-body');
    if (summaryTableBody) {
        summaryTableBody.innerHTML = '';
    }
    
    // Clear intensity labels from canvas container
    const intensityLabelsContainer = document.getElementById('intensity-labels');
    if (intensityLabelsContainer) {
        intensityLabelsContainer.innerHTML = '';
    }
    
    // Redraw canvas if there's an image loaded
    if (uploadedImages.length > 0) {
        const currentImage = uploadedImages[currentImageIndex];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(currentImage.canvas, 0, 0);
    }
    
    // Reset drawing state
    isDrawing = false;
    currentRegion = null;
    
    alert('All analysis results have been cleared successfully!');
}

// Start manual region selection
function startManualSelection() {
    if (uploadedImages.length === 0) {
        alert('Please upload an image first');
        return;
    }
    
    const currentImage = uploadedImages[currentImageIndex];
    const shapeType = document.getElementById('selection-shape').value;
    
    alert(`Please drag the mouse on the image to select a ${shapeType} region`);
    currentRegion = {
        points: [],
        id: currentImage.regions.length + 1,
        shape: shapeType
    };
    isDrawing = true;
}

// Start drawing
function startDrawing(e) {
    if (!isDrawing || uploadedImages.length === 0) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    currentRegion.points = [{x, y}];
}

// Draw
function draw(e) {
    if (!isDrawing || uploadedImages.length === 0 || currentRegion.points.length === 0) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Clear canvas and redraw image
    const currentImage = uploadedImages[currentImageIndex];
    ctx.drawImage(currentImage.canvas, 0, 0);
    
    // Draw existing regions
    drawRegions();
    
    // Draw current region
    currentRegion.points[1] = {x, y};
    drawRegion(currentRegion);
}

// End drawing
function endDrawing() {
    if (!isDrawing || uploadedImages.length === 0 || currentRegion.points.length < 2) {
        isDrawing = false;
        return;
    }
    
    const currentImage = uploadedImages[currentImageIndex];
    
    // Add region to current image's regions array
    currentImage.regions.push(currentRegion);
    
    // Redraw image and regions
    ctx.drawImage(currentImage.canvas, 0, 0);
    currentImage.regions.forEach(region => drawRegion(region));
    
    isDrawing = false;
    currentRegion = null;
    
    alert('Region selection completed!');
}

// Auto analyze
function autoAnalyze() {
    if (uploadedImages.length === 0) {
        alert('Please upload an image first');
        return;
    }
    
    const currentImage = uploadedImages[currentImageIndex];
    
    // Clear previous analysis results for current image
    currentImage.regions = [];
    currentImage.results = [];
    
    // Detect sample tray region
    const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const trayRegion = detectSampleTray(fullImageData, canvas.width, canvas.height);
    
    // Store the detected tray region for this image
    sampleTrayRegions.set(currentImageIndex, trayRegion);
    
    console.log('Detected sample tray region:', trayRegion);
    
    // Define grid columns and rows
    const cols = 11;
    const rows = 4;
    
    // Calculate size of each cell within the tray region
    const cellWidth = trayRegion.width / cols;
    const cellHeight = trayRegion.height / rows;
    
    // Create 11 columns × 4 rows grid regions within the tray region
    let regionId = 1;
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = trayRegion.x + col * cellWidth;
            const y = trayRegion.y + row * cellHeight;
            
            currentImage.regions.push({
                id: regionId++,
                points: [
                    {x: x, y: y},
                    {x: x + cellWidth, y: y + cellHeight}
                ],
                row: row + 1,
                col: col + 1
            });
        }
    }
    
    // Draw regions
    ctx.drawImage(currentImage.canvas, 0, 0);
    
    // Draw the tray region boundary (for visualization)
    ctx.strokeStyle = 'blue';
    ctx.lineWidth = 3;
    ctx.strokeRect(trayRegion.x, trayRegion.y, trayRegion.width, trayRegion.height);
    
    // Draw grid regions
    currentImage.regions.forEach(region => drawRegion(region));
    
    alert(`Auto analysis completed! Detected sample tray and generated ${cols} columns × ${rows} rows grid regions within the tray area.`);
}

// Draw all regions
function drawRegions() {
    if (uploadedImages.length === 0) return;
    const currentImage = uploadedImages[currentImageIndex];
    if (currentImage.regions) {
        currentImage.regions.forEach(region => drawRegion(region));
    }
}

// Draw single region
function drawRegion(region) {
    if (region.points.length < 2) return;
    
    const [p1, p2] = region.points;
    const shape = region.shape || 'rectangle';
    
    ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    ctx.lineWidth = 2;
    
    if (shape === 'rectangle') {
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const width = Math.abs(p2.x - p1.x);
        const height = Math.abs(p2.y - p1.y);
        
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
        
        // Draw region ID
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`R${region.id}`, x + 5, y + 15);
    } else if (shape === 'circle') {
        const centerX = (p1.x + p2.x) / 2;
        const centerY = (p1.y + p2.y) / 2;
        const radius = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) / 2;
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // Draw region ID
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`R${region.id}`, centerX, centerY + 5);
        ctx.textAlign = 'left';
    } else if (shape === 'ellipse') {
        const centerX = (p1.x + p2.x) / 2;
        const centerY = (p1.y + p2.y) / 2;
        const radiusX = Math.abs(p2.x - p1.x) / 2;
        const radiusY = Math.abs(p2.y - p1.y) / 2;
        
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // Draw region ID
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`R${region.id}`, centerX, centerY + 5);
        ctx.textAlign = 'left';
    }
}

// Calculate intensity
function calculateIntensity() {
    if (uploadedImages.length === 0) {
        alert('Please upload an image first');
        return;
    }
    
    const currentImage = uploadedImages[currentImageIndex];
    
    if (currentImage.regions.length === 0) {
        alert('Please select regions first');
        return;
    }
    
    // Use the current image's intensity values
    const minIntensity = currentImage.minimumIntensity || parseInt(intensityMin.value) || 0;
    const maxIntensity = currentImage.maximumIntensity || parseInt(intensityMax.value) || 353515;
    
    // Analyze each region
    const results = [];
    
    currentImage.regions.forEach(region => {
        const [p1, p2] = region.points;
        const shape = region.shape || 'rectangle';
        
        let totalIntensity = 0;
        let validPixels = 0;
        
        if (shape === 'rectangle') {
            // Rectangle region calculation
            const x = Math.min(p1.x, p2.x);
            const y = Math.min(p1.y, p2.y);
            const width = Math.abs(p2.x - p1.x);
            const height = Math.abs(p2.y - p1.y);
            
            // Get region pixel data
            const imageData = ctx.getImageData(x, y, width, height);
            const data = imageData.data;
            
            // Calculate intensity for each pixel
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
                const intensity = brightness * (maxIntensity - minIntensity) + minIntensity;
                
                if (intensity > maxIntensity * 0.01) {
                    totalIntensity += intensity;
                    validPixels++;
                }
            }
        } else if (shape === 'circle' || shape === 'ellipse') {
            // Circle/Ellipse region calculation
            const centerX = (p1.x + p2.x) / 2;
            const centerY = (p1.y + p2.y) / 2;
            const radiusX = Math.abs(p2.x - p1.x) / 2;
            const radiusY = shape === 'circle' ? radiusX : Math.abs(p2.y - p1.y) / 2;
            
            // Get the bounding rectangle
            const x = Math.max(0, Math.floor(centerX - radiusX));
            const y = Math.max(0, Math.floor(centerY - radiusY));
            const width = Math.min(currentImage.canvas.width - x, Math.ceil(radiusX * 2));
            const height = Math.min(currentImage.canvas.height - y, Math.ceil(radiusY * 2));
            
            // Get region pixel data
            const imageData = ctx.getImageData(x, y, width, height);
            const data = imageData.data;
            
            // Calculate intensity for each pixel
            for (let py = 0; py < height; py++) {
                for (let px = 0; px < width; px++) {
                    const index = (py * width + px) * 4;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];
                    
                    // Check if pixel is inside the shape
                    const dx = (x + px) - centerX;
                    const dy = (y + py) - centerY;
                    const distance = (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY);
                    
                    if (distance <= 1) {
                        const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
                        const intensity = brightness * (maxIntensity - minIntensity) + minIntensity;
                        
                        if (intensity > maxIntensity * 0.01) {
                            totalIntensity += intensity;
                            validPixels++;
                        }
                    }
                }
            }
        }
        
        const avgIntensity = validPixels > 0 ? totalIntensity / validPixels : 0;
        
        // Create result object, including row and column information
        const result = {
            region: region.id,
            totalIntensity: totalIntensity.toFixed(2),
            validPixels: validPixels,
            avgIntensity: avgIntensity.toFixed(2)
        };
        
        // If there is row and column information, add to result
        if (region.row && region.col) {
            result.row = region.row;
            result.col = region.col;
            result.label = `R${region.row}C${region.col}`;
        }
        
        results.push(result);
        
        // Display intensity value on image
        displayIntensityLabel(region, totalIntensity.toFixed(2));
    });
    
    // Store results in current image
    currentImage.results = results;
    
    // Update results table
    updateResultsTable(results);
    
    alert('Intensity calculation completed!');
}

// Display intensity value on image
function displayIntensityLabel(region, intensity) {
    const [p1, p2] = region.points;
    const shape = region.shape || 'rectangle';
    
    let x, y;
    
    if (shape === 'rectangle') {
        x = Math.min(p1.x, p2.x);
        y = Math.min(p1.y, p2.y);
        const width = Math.abs(p2.x - p1.x);
        const height = Math.abs(p2.y - p1.y);
        // Place label in center of rectangle
        x = x + width / 2 - 30;
        y = y + height / 2 - 10;
    } else if (shape === 'circle' || shape === 'ellipse') {
        // Place label in center of circle/ellipse
        x = (p1.x + p2.x) / 2 - 30;
        y = (p1.y + p2.y) / 2 - 10;
    }
    
    const label = document.createElement('div');
    label.className = 'intensity-label';
    label.style.position = 'absolute';
    
    label.style.left = x + 'px';
    label.style.top = y + 'px';
    
    label.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
    label.style.color = 'white';
    label.style.padding = '2px 6px';
    label.style.borderRadius = '4px';
    label.style.fontSize = '10px';
    label.style.fontWeight = 'bold';
    label.style.textAlign = 'center';
    label.style.whiteSpace = 'nowrap';
    
    // Format intensity value to make it more concise
    const formattedIntensity = parseFloat(intensity).toLocaleString('en-US', { maximumFractionDigits: 0 });
    label.textContent = formattedIntensity;
    
    intensityLabels.appendChild(label);
}

// Clear intensity labels
function clearIntensityLabels() {
    intensityLabels.innerHTML = '';
}

// Update results table
function updateResultsTable(results = []) {
    resultsBody.innerHTML = '';
    
    results.forEach(result => {
        const row = document.createElement('tr');
        
        // If there is row and column information, display them
        if (result.label) {
            row.innerHTML = '<td>' + result.label + '</td><td>' + result.totalIntensity + '</td><td>' + result.validPixels + '</td><td>' + result.avgIntensity + '</td>';
        } else {
            row.innerHTML = '<td>Region ' + result.region + '</td><td>' + result.totalIntensity + '</td><td>' + result.validPixels + '</td><td>' + result.avgIntensity + '</td>';
        }
        
        resultsBody.appendChild(row);
    });
}

// Export results
function exportResults() {
    if (uploadedImages.length === 0) {
        alert('Please upload an image first');
        return;
    }
    
    const currentImage = uploadedImages[currentImageIndex];
    
    if (currentImage.results.length === 0) {
        alert('Please analyze the image first');
        return;
    }
    
    // Get table data
    const table = document.querySelector('.results-table table');
    let csvContent = 'data:text/csv;charset=utf-8,';
    
    // Add headers
    const headers = table.querySelectorAll('th');
    const headerRow = Array.from(headers).map(header => header.textContent).join(',');
    csvContent += headerRow + '\n';
    
    // Add data rows
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const rowData = Array.from(cells).map(cell => cell.textContent).join(',');
        csvContent += rowData + '\n';
    });
    
    // Create download link
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'intensity_analysis_results.csv');
    document.body.appendChild(link);
    
    // Trigger download
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    
    alert('Results exported successfully!');
}

// Export Excel
function exportExcel() {
    if (uploadedImages.length === 0) {
        alert('Please upload an image first');
        return;
    }
    
    const currentImage = uploadedImages[currentImageIndex];
    
    if (currentImage.results.length === 0) {
        alert('Please analyze the image first');
        return;
    }
    
    // Display export progress
    uploadStatus.textContent = 'Exporting Excel file...';
    uploadStatus.className = 'status';
    uploadProgress.querySelector('.progress-fill').style.width = '0%';
    
    try {
        // Get table data
        const table = document.querySelector('.results-table table');
        const headers = table.querySelectorAll('th');
        const rows = table.querySelectorAll('tbody tr');
        
        // Prepare data
        const data = [];
        
        // Add headers
        const headerRow = Array.from(headers).map(header => header.textContent);
        data.push(headerRow);
        
        // Add data rows
        rows.forEach((row, index) => {
            const cells = row.querySelectorAll('td');
            const rowData = Array.from(cells).map(cell => {
                const text = cell.textContent;
                // Try to convert to number
                const num = parseFloat(text);
                return isNaN(num) ? text : num;
            });
            data.push(rowData);
            
            // Update progress
            const progress = ((index + 1) / rows.length) * 100;
            uploadProgress.querySelector('.progress-fill').style.width = progress + '%';
        });
        
        // Create Excel workbook
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(data);
        
        // Set column widths
        const wscols = [
            { wch: 10 }, // Region
            { wch: 15 }, // Total Intensity
            { wch: 12 }, // Valid Pixels
            { wch: 12 }  // Average Intensity
        ];
        ws['!cols'] = wscols;
        
        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(wb, ws, 'Analysis Results');
        
        // Generate filename
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const fileName = `Analysis_Results_${date}_MSI_Intensity.xlsx`;
        
        // Export Excel file
        XLSX.writeFile(wb, fileName);
        
        // Display success message
        uploadStatus.textContent = 'Excel file exported successfully!';
        uploadStatus.className = 'status success';
        uploadProgress.querySelector('.progress-fill').style.width = '100%';
        
        alert('Excel file exported successfully!');
    } catch (error) {
        // Handle export failure
        uploadStatus.textContent = 'Export failed: ' + error.message;
        uploadStatus.className = 'status error';
        alert('Export failed: ' + error.message);
    }
}

// Global variables for summary table
let summaryData = [];
let summarySortOrder = 'asc'; // 'asc' or 'desc'

// Initialize application
init();

// Bind summary table events
function bindSummaryEvents() {
    document.getElementById('generate-summary').addEventListener('click', generateSummaryTable);
    document.getElementById('auto-generate-summary').addEventListener('click', autoGenerateSummaryTable);
    document.getElementById('sort-regions').addEventListener('click', toggleSortRegions);
    document.getElementById('export-summary-csv').addEventListener('click', exportSummaryCSV);
    document.getElementById('export-summary-excel').addEventListener('click', exportSummaryExcel);
}

// Generate summary table
function generateSummaryTable() {
    if (uploadedImages.length === 0) {
        alert('Please upload images first');
        return;
    }
    
    // Check if any image has analysis results
    const hasResults = uploadedImages.some(img => img.results && img.results.length > 0);
    if (!hasResults) {
        alert('Please analyze at least one image first');
        return;
    }
    
    // Display loading status
    uploadStatus.textContent = 'Generating summary table...';
    uploadStatus.className = 'status';
    uploadProgress.querySelector('.progress-fill').style.width = '0%';
    
    // Collect all unique regions
    const allRegions = new Set();
    uploadedImages.forEach(img => {
        if (img.results && img.results.length > 0) {
            img.results.forEach(result => {
                const regionName = result.label || `Region ${result.region}`;
                allRegions.add(regionName);
            });
        }
    });
    
    // Convert set to sorted array
    const sortedRegions = Array.from(allRegions).sort();
    
    // Prepare summary data
    summaryData = [];
    sortedRegions.forEach(regionName => {
        const row = { region: regionName };
        uploadedImages.forEach(img => {
            if (img.results && img.results.length > 0) {
                const result = img.results.find(r => (r.label || `Region ${r.region}`) === regionName);
                row[img.name] = result ? parseFloat(result.totalIntensity) : 0;
            } else {
                row[img.name] = 0;
            }
        });
        summaryData.push(row);
    });
    
    // Update progress
    uploadProgress.querySelector('.progress-fill').style.width = '50%';
    
    // Display summary table
    displaySummaryTable();
    
    // Update progress
    uploadProgress.querySelector('.progress-fill').style.width = '100%';
    uploadStatus.textContent = 'Summary table generated successfully!';
    uploadStatus.className = 'status success';
}

// Auto generate summary table with batch processing
async function autoGenerateSummaryTable() {
    if (uploadedImages.length === 0) {
        alert('Please upload images first');
        return;
    }
    
    // Check if number of images exceeds limit
    if (uploadedImages.length > 500) {
        alert('Maximum 500 images can be processed at once. Please reduce the number of images.');
        return;
    }
    
    // Estimate processing time
    const estimatedTime = Math.ceil(uploadedImages.length * 0.5); // 0.5 seconds per image estimate
    const timeMessage = estimatedTime > 60 
        ? `approximately ${Math.ceil(estimatedTime / 60)} minutes` 
        : `approximately ${estimatedTime} seconds`;
    
    // Confirm batch processing
    const confirmMsg = `This will automatically analyze all ${uploadedImages.length} images and generate a summary table.\n\nEstimated processing time: ${timeMessage}\n\nDo you want to continue?`;
    if (!confirm(confirmMsg)) {
        return;
    }
    
    // Display loading status
    uploadStatus.textContent = 'Starting batch analysis...';
    uploadStatus.className = 'status';
    uploadProgress.querySelector('.progress-fill').style.width = '0%';
    
    const totalImages = uploadedImages.length;
    const failedImages = [];
    const successCount = { value: 0 };
    const startTime = Date.now();
    
    // Process each image
    for (let i = 0; i < totalImages; i++) {
        const img = uploadedImages[i];
        const progress = ((i + 1) / totalImages) * 100;
        
        try {
            uploadStatus.textContent = `Processing image ${i + 1}/${totalImages}: ${img.name}`;
            uploadProgress.querySelector('.progress-fill').style.width = progress + '%';
            
            // Switch to current image
            currentImageIndex = i;
            
            // Perform auto analysis for this image
            await performAutoAnalysisForImage(img);
            
            // Calculate intensity for this image
            await performIntensityCalculationForImage(img);
            
            successCount.value++;
            
            // Small delay to prevent UI freezing (longer delay for large batches)
            const delay = totalImages > 100 ? 100 : 50;
            await new Promise(resolve => setTimeout(resolve, delay));
            
        } catch (error) {
            console.error(`Failed to process image ${img.name}:`, error);
            failedImages.push({
                name: img.name,
                error: error.message
            });
        }
    }
    
    const endTime = Date.now();
    const actualTime = ((endTime - startTime) / 1000).toFixed(2);
    
    // Display final status
    if (failedImages.length > 0) {
        const errorMsg = `Batch processing completed in ${actualTime} seconds.\n\nSuccess: ${successCount.value} images\nFailed: ${failedImages.length} images\n\nFailed images:\n${failedImages.map(f => `${f.name}: ${f.error}`).join('\n')}`;
        alert(errorMsg);
        uploadStatus.textContent = `Batch processing completed: ${successCount.value} succeeded, ${failedImages.length} failed`;
        uploadStatus.className = 'status error';
    } else {
        const successMsg = `Batch processing completed successfully in ${actualTime} seconds!\n\nAll ${totalImages} images have been analyzed and the summary table has been generated.`;
        alert(successMsg);
        uploadStatus.textContent = 'Batch processing completed successfully!';
        uploadStatus.className = 'status success';
    }
    
    uploadProgress.querySelector('.progress-fill').style.width = '100%';
    
    // Generate summary table after all images are processed
    if (successCount.value > 0) {
        uploadStatus.textContent = 'Generating summary table...';
        generateSummaryTable();
    }
}

// Perform auto analysis for a specific image
async function performAutoAnalysisForImage(img) {
    // Clear previous analysis results for this image
    img.regions = [];
    img.results = [];
    
    // Define grid columns and rows
    const cols = 11;
    const rows = 4;
    
    // Calculate size of each cell
    const cellWidth = img.width / cols;
    const cellHeight = img.height / rows;
    
    // Create 11 columns × 4 rows grid regions
    let regionId = 1;
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = col * cellWidth;
            const y = row * cellHeight;
            
            img.regions.push({
                id: regionId++,
                points: [
                    {x: x, y: y},
                    {x: x + cellWidth, y: y + cellHeight}
                ],
                row: row + 1,
                col: col + 1
            });
        }
    }
}

// Perform intensity calculation for a specific image
async function performIntensityCalculationForImage(img) {
    const minIntensity = img.minimumIntensity || parseInt(intensityMin.value) || 0;
    const maxIntensity = img.maximumIntensity || parseInt(intensityMax.value) || 353515;
    
    // Create a temporary canvas for this image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img.canvas, 0, 0);
    
    // Analyze each region
    const results = [];
    
    img.regions.forEach(region => {
        const [p1, p2] = region.points;
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const width = Math.abs(p2.x - p1.x);
        const height = Math.abs(p2.y - p1.y);
        
        // Get region pixel data
        const imageData = tempCtx.getImageData(x, y, width, height);
        const data = imageData.data;
        
        let totalIntensity = 0;
        let validPixels = 0;
        
        // Calculate intensity for each pixel
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // Simple intensity calculation: brightness based on RGB values
            const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
            const intensity = brightness * (maxIntensity - minIntensity) + minIntensity;
            
            // Background subtraction
            if (intensity > maxIntensity * 0.01) {
                totalIntensity += intensity;
                validPixels++;
            }
        }
        
        const avgIntensity = validPixels > 0 ? totalIntensity / validPixels : 0;
        
        // Create result object, including row and column information
        const result = {
            region: region.id,
            totalIntensity: totalIntensity.toFixed(2),
            validPixels: validPixels,
            avgIntensity: avgIntensity.toFixed(2)
        };
        
        // If there is row and column information, add to result
        if (region.row && region.col) {
            result.row = region.row;
            result.col = region.col;
            result.label = `R${region.row}C${region.col}`;
        }
        
        results.push(result);
    });
    
    // Store results in image
    img.results = results;
}

// Display summary table
function displaySummaryTable() {
    const header = document.getElementById('summary-table-header');
    const body = document.getElementById('summary-table-body');
    const summaryTable = document.querySelector('.summary-table');
    
    // Clear existing content
    header.innerHTML = '';
    body.innerHTML = '';
    
    // Create header row
    const regionHeader = document.createElement('th');
    regionHeader.textContent = 'Region';
    header.appendChild(regionHeader);
    
    uploadedImages.forEach(img => {
        const imgHeader = document.createElement('th');
        imgHeader.textContent = `Total Intensity (${img.name})`;
        header.appendChild(imgHeader);
    });
    
    // Create data rows
    summaryData.forEach(row => {
        const tr = document.createElement('tr');
        
        // Region column
        const regionTd = document.createElement('td');
        regionTd.textContent = row.region;
        tr.appendChild(regionTd);
        
        // Intensity columns
        uploadedImages.forEach(img => {
            const intensityTd = document.createElement('td');
            intensityTd.textContent = row[img.name].toFixed(2);
            tr.appendChild(intensityTd);
        });
        
        body.appendChild(tr);
    });
    
    // Show summary table
    summaryTable.style.display = 'block';
}

// Toggle sort regions
function toggleSortRegions() {
    summarySortOrder = summarySortOrder === 'asc' ? 'desc' : 'asc';
    
    // Sort summary data
    summaryData.sort((a, b) => {
        if (summarySortOrder === 'asc') {
            return a.region.localeCompare(b.region);
        } else {
            return b.region.localeCompare(a.region);
        }
    });
    
    // Redisplay table
    displaySummaryTable();
    
    // Update button text
    const sortButton = document.getElementById('sort-regions');
    sortButton.textContent = `Sort Regions (${summarySortOrder === 'asc' ? 'Ascending' : 'Descending'})`;
}

// Export summary as CSV
function exportSummaryCSV() {
    if (summaryData.length === 0) {
        alert('Please generate summary table first');
        return;
    }
    
    // Prepare CSV content
    let csvContent = 'data:text/csv;charset=utf-8,';
    
    // Add headers
    const headers = ['Region'];
    uploadedImages.forEach(img => {
        headers.push(`Total Intensity (${img.name})`);
    });
    csvContent += headers.join(',') + '\n';
    
    // Add data rows
    summaryData.forEach(row => {
        const rowData = [row.region];
        uploadedImages.forEach(img => {
            rowData.push(row[img.name].toFixed(2));
        });
        csvContent += rowData.join(',') + '\n';
    });
    
    // Create download link
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    
    // Generate filename
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = date.toTimeString().slice(0, 8).replace(/:/g, '');
    const fileName = `Analysis_Summary_${dateStr}_${timeStr}.csv`;
    
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    
    // Trigger download
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    
    alert('Summary CSV exported successfully!');
}

// Export summary as Excel
function exportSummaryExcel() {
    if (summaryData.length === 0) {
        alert('Please generate summary table first');
        return;
    }
    
    // Display export progress
    uploadStatus.textContent = 'Exporting summary Excel file...';
    uploadStatus.className = 'status';
    uploadProgress.querySelector('.progress-fill').style.width = '0%';
    
    try {
        // Prepare data
        const data = [];
        
        // Add headers
        const headers = ['Region'];
        uploadedImages.forEach(img => {
            headers.push(`Total Intensity (${img.name})`);
        });
        data.push(headers);
        
        // Add data rows
        summaryData.forEach((row, index) => {
            const rowData = [row.region];
            uploadedImages.forEach(img => {
                rowData.push(row[img.name]);
            });
            data.push(rowData);
            
            // Update progress
            const progress = ((index + 1) / summaryData.length) * 100;
            uploadProgress.querySelector('.progress-fill').style.width = progress + '%';
        });
        
        // Create Excel workbook
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(data);
        
        // Set column widths
        const wscols = [{ wch: 15 }]; // Region column
        uploadedImages.forEach(() => {
            wscols.push({ wch: 20 }); // Intensity columns
        });
        ws['!cols'] = wscols;
        
        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(wb, ws, 'Summary Results');
        
        // Generate filename
        const date = new Date();
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const timeStr = date.toTimeString().slice(0, 8).replace(/:/g, '');
        const fileName = `Analysis_Summary_${dateStr}_${timeStr}.xlsx`;
        
        // Export Excel file
        XLSX.writeFile(wb, fileName);
        
        // Display success message
        uploadStatus.textContent = 'Summary Excel file exported successfully!';
        uploadStatus.className = 'status success';
        uploadProgress.querySelector('.progress-fill').style.width = '100%';
        
        alert('Summary Excel file exported successfully!');
    } catch (error) {
        // Handle export failure
        uploadStatus.textContent = 'Export failed: ' + error.message;
        uploadStatus.className = 'status error';
        alert('Export failed: ' + error.message);
    }
}