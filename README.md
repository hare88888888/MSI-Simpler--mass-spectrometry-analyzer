# Mass Spectrometry Imaging Analysis System

## 📁 Project Overview

This is a web-based Mass Spectrometry Imaging Analysis System. **No installation required, no internet connection needed** - simply download and use offline.

## 🚀 Quick Start

1. **Download & Extract**: Extract the ZIP file to any folder
2. **Launch Application**: Double-click `index.html` to open
3. **Start Analysis**: All analysis features are available in your browser

> **Note**: Recommended browsers: Chrome, Firefox, Safari, or Edge

## ✨ Features

### 1. Data Import
- Supports TIFF/PNG/JPG/GIF/BMP image formats
- Batch upload multiple images at once
- Real-time upload progress and status feedback

### 2. Color Bar Management
- Set minimum and maximum intensity values
- Visual color bar display
- Save and load different color schemes

### 3. Image Analysis
- **Auto Analysis**: Automatically detect sample tray and analyze
- **Manual Selection**: Drag to select regions of interest
- **Intensity Calculation**: Quantitative analysis based on color bar
- **Result Display**: Overlay intensity values on images

### 4. Result Export
- Export analysis results as CSV
- Export to Excel format

## 📁 Project Structure

```
├── index.html                      # Main page
├── style.css                       # Stylesheet
├── script.js                       # Core analysis logic
├── HotMetal2.jpg                   # Color bar image
├── 1.tif / 2.tif / 3.tif           # Sample images
├── 2.png                           # Sample image
└── README.md                       # Documentation
```

## 🛠️ Technical Implementation

- **Frontend**: HTML5 + CSS3 + JavaScript
- **Image Processing**: Canvas API
- **Data Storage**: localStorage (for color schemes)

## 🌐 Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## ⚠️ Important Notes

1. All analysis operations are performed locally in the browser. **No data is uploaded to servers**
2. Modern browsers are recommended for best performance
3. Large images may require additional processing time - please be patient

## 📄 License

© 2026 Mass Spectrometry Imaging Analysis System

For research and educational use only.