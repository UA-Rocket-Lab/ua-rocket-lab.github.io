/* app.js */

const npy = new npyjs();

console.log('npyjs:', npyjs);

// Global Variables
let plotData = [];
let integratedH2Map = [];
let h2EmissionCube = null;
let h2EmissionWavelengths = null; // New Variable for Wavelengths

let currentSpectrumData = null;
let currentContinuumData = null;
let currentStarName = null;

let nighttimeFracMap = {};
let selectedStars = [];

const selectedStarNameSpan = document.getElementById('selected-star-name');
const selectedLatLonSpan = document.getElementById('selected-latlon');

// Utility Functions to Show/Hide Elements
function showElement(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = 'flex'; // or 'block' based on your layout
}

function hideElement(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = 'none';
}

/**
 * Loads and parses a .npz file, extracting 'wavelengths' and 'fluxes'.
 * @param {string} url - The URL to the .npz file.
 * @returns {Promise<Object>} - An object containing 'wavelengths' and 'fluxes' arrays.
 */
async function loadNpzFile(url) {
    try {
        // Fetch the .npz file as an ArrayBuffer
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();

        // Load the zip archive using JSZip
        const zip = await JSZip.loadAsync(arrayBuffer);

        // Initialize an object to hold the extracted arrays
        const extractedData = {};

        // Iterate over each file in the zip archive
        const promises = Object.keys(zip.files).map(async (filename) => {
            if (filename.endsWith('.npy')) {
                // Extract the .npy file as an ArrayBuffer
                const fileData = await zip.file(filename).async('arraybuffer');

                // Parse the .npy file using npyjs
                const parsedArray = npy.parse(fileData);

                // Remove the .npy extension to use as the key
                const key = filename.replace('.npy', '');

                // Assign the parsed array to the corresponding key
                extractedData[key] = parsedArray;
            }
        });

        // Wait for all files to be processed
        await Promise.all(promises);

        console.log('Extracted Data:', extractedData);
        return extractedData;
    } catch (error) {
        console.error('Error loading .npz file:', error);
    }
}

// Load Data
async function loadData() {
    const plotResponse = await fetch('static/data/plot_data.json');
    plotData = await plotResponse.json();

    const heatmapResponse = await fetch('static/data/integrated_h2_map.json');
    integratedH2Map = await heatmapResponse.json();

    // Load the .npz file instead of the JSON file
    const npzData = await loadNpzFile('static/data/h2_emission_cube.npz');
    if (npzData) {
        h2EmissionCube = convertTo3DArray(npzData.fluxes['data']); // Array of 340 flux values
        h2EmissionWavelengths = npzData.wavelengths['data']; // Array of 340 wavelength values

    } else {
        console.error('Failed to load .npz data.');
    }

    // Load Nighttime Fraction Data
    const nighttimeResponse = await fetch('static/data/nighttime_frac.json');
    const nighttimeRaw = await nighttimeResponse.json();
    nighttimeFracMap = {};

    nighttimeRaw.data.forEach(entry => {
        const [name, oct, nov, dec, jan, feb, mar] = entry;
        nighttimeFracMap[name] = [parseInt(oct), parseInt(nov), parseInt(dec), parseInt(jan), parseInt(feb), parseInt(mar)];
    });
}

// Initialize Plots
async function initializePlots() {
    await loadData();
    if (!plotData.length) {
        return;
    }

    selectedStars = [];
    updateSelectedStars();

    const spectraCheckbox = document.getElementById('show-spectra-checkbox');
    const bgCheckbox = document.getElementById('show-bg-checkbox');
    const normCheckbox = document.getElementById('norm-spectra-checkbox');
    const contCheckbox = document.getElementById('show-cont-checkbox');

    const filterHasSpectra = spectraCheckbox ? spectraCheckbox.checked : false;
    const showHeatmap = bgCheckbox ? bgCheckbox.checked : false;

    plotStars(filterHasSpectra, showHeatmap);

    if (spectraCheckbox) {
        spectraCheckbox.addEventListener('change', e => {
            const isChecked = e.target.checked;
            plotStars(isChecked, bgCheckbox ? bgCheckbox.checked : false);
        });
    }

    if (bgCheckbox) {
        bgCheckbox.addEventListener('change', e => {
            const isChecked = e.target.checked;
            plotStars(spectraCheckbox ? spectraCheckbox.checked : false, isChecked);
        });
    }

    if (normCheckbox) {
        normCheckbox.addEventListener('change', e => {
            if (currentSpectrumData) {
                plotSpectrum(currentSpectrumData, e.target.checked, currentContinuumData);
            }
        });
    }

    if (contCheckbox) {
        contCheckbox.addEventListener('change', async function(e) {
            const isChecked = e.target.checked;
            if (currentSpectrumData && currentStarName) { // Ensure currentStarName is set
                if (isChecked) {
                    // Load and plot continuum data
                    const continuumData = await loadContinuumData(currentStarName); // Use currentStarName
                    if (continuumData) {
                        currentContinuumData = continuumData;
                        const normCheckbox = document.getElementById('norm-spectra-checkbox');
                        const normalize = normCheckbox ? normCheckbox.checked : false;
                        plotSpectrum(currentSpectrumData, normalize, continuumData);
                    }
                } else {
                    // Remove continuum from plot
                    const normCheckbox = document.getElementById('norm-spectra-checkbox');
                    const normalize = normCheckbox ? normCheckbox.checked : false;
                    plotSpectrum(currentSpectrumData, normalize, null);
                    currentContinuumData = null;
                }
            }
        });
    }    

    document.getElementById('IUE-spectra-plot').innerHTML = `
        <div class="iue-spectrum-message">
            Click on star to see its IUE spectrum
        </div>
    `;

    document.getElementById('star-info').innerHTML = `
        <div style="text-align: center;">
            Click on a star to see its information
        </div>
    `;

    // Initialize Selected Stars as Empty
    selectedStars = [];
    updateSelectedStars();

    // Plotly click
    const plotElement = document.getElementById('scatter-plot');
    plotElement.on('plotly_click', handlePlotClick);

    // Plotly selection events
    plotElement.on('plotly_selected', handleSelection);
    plotElement.on('plotly_deselect', handleDeselection);

    // Download button event listener
    const downloadBtn = document.getElementById('download-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadSelectedStarsCSV);
    }
}

function generateTraces(filterHasSpectra) {
    const spectralColors = {
        'O-type': '#1000FF',
        'B-type': '#FF0000'
    };
    const filteredData = filterHasSpectra
        ? plotData.filter(star => star["HasSpectra"] === true)
        : plotData;
    const groupedData = filteredData.reduce((acc, star) => {
        const type = star["Color"];
        if (!acc[type]) acc[type] = [];
        acc[type].push(star);
        return acc;
    }, {});
    return Object.keys(groupedData).map(type => {
        const stars = groupedData[type];
        return {
            x: stars.map(d => d["Galactic Longitude"]),
            y: stars.map(d => d["Galactic Latitude"]),
            customdata: stars.map(d => ({
                Name: d["Name"],
                SpectralType: d["Spectral Type"],
                ApparentMagnitude: d["Apparent Magnitude"].toFixed(2),
                GAL_LAT: Number(d["Galactic Latitude"]).toFixed(1), // Rounded to 1 decimal
                GAL_LON: Number(d["Galactic Longitude"]).toFixed(1), // Rounded to 1 decimal
                HasSpectra: d["HasSpectra"],
                IUESpectra: d["IUESpectra"]
            })),
            mode: 'markers',
            marker: {
                size: stars.map(d => d["Size"]),
                color: spectralColors[type] || '#000000',
                line: { width: 0 }
            },
            name: `${type} Stars`,
            type: 'scatter',
            hovertemplate:
                `<b>%{customdata.Name}</b><br>` +
                `Spectral Type: %{customdata.SpectralType}<br>` +
                `Apparent Magnitude: %{customdata.ApparentMagnitude}<br>` +
                `Galactic Latitude: %{customdata.GAL_LAT}°<br>` +
                `Galactic Longitude: %{customdata.GAL_LON}°<extra></extra>`
        };
    });
}

function plotStars(filterHasSpectra = false, showHeatmap = false) {
    const traces = generateTraces(filterHasSpectra);
    if (showHeatmap) {
        const heatmapTrace = generateHeatmapTrace();
        traces.unshift(heatmapTrace);
    }
    const layout = {
        hovermode: 'closest',
        xaxis: { title: 'Galactic Longitude (°)', range: [0, 360], ticklabelposition: "outside top", side: "top", showgrid: false },
        yaxis: { title: 'Galactic Latitude (°)', range: [-90, 90], showgrid: false },
        plot_bgcolor: 'white',
        paper_bgcolor: 'white',
        legend: {
            title: { text: 'Stars', font: { size: 22, color: '#333333' } },
            font: { size: 18, color: '#000000' },
            x: 1.07, y: 1.13, xanchor: "left", yanchor: "top"
        },
        shapes: generateGridLines()
    };
    const config = {
        responsive: true,
        modeBarButtonsToRemove: ['autoScale2d', 'hoverClosestCartesian', 'hoverCompareCartesian', 'toggleSpikelines']
    };
    Plotly.react('scatter-plot', traces, layout, config);
}

function plotSpectrum(spectrumData, normalize, continuumData = null) {
    let traces = [];
    if (Array.isArray(spectrumData['wavelength'][0])) {
        spectrumData['wavelength'].forEach((wavelength, index) => {
            let flux = spectrumData['flux'][index];
            if (normalize) flux = normalizeFlux(flux);
            traces.push({ x: wavelength, y: flux, mode: 'lines', type: 'scatter', line: { color: 'black' } });
        });
    } else {
        let flux = spectrumData['flux'];
        if (normalize) flux = normalizeFlux(flux);
        traces.push({ x: spectrumData['wavelength'], y: flux, mode: 'lines', type: 'scatter', line: { color: 'black' } });
    }
    if (continuumData) {
        let avgFlux = continuumData['avg'].map(row => row[1]);
        if (normalize) avgFlux = normalizeFlux(avgFlux);
        traces.push({
            x: continuumData['avg'].map(row => row[0]),
            y: avgFlux, mode: 'lines', type: 'scatter', line: { color: 'red' }
        });
        let contFlux = continuumData['cont'].map(row => row[1]);
        if (normalize) contFlux = normalizeFlux(contFlux);
        traces.push({
            x: continuumData['cont'].map(row => row[0]),
            y: contFlux, mode: 'lines', type: 'scatter', line: { color: 'blue', dash: 'dash' }
        });
    }
    const layout = {
        xaxis: { title: 'Wavelength (Å)' },
        yaxis: { title: 'Specific Intensity', showticklabels: false },
        margin: { l: 40, r: 10, t: 10, b: 40 },
        showlegend: false,
        shapes: [
            {
                type: 'rect',
                x0: 1395,
                y0: 0,
                x1: 1405,
                y1: 1,
                xref: 'x',
                yref: 'paper',
                fillcolor: 'rgba(255,0,0,0.2)',
                line: {
                    color: 'rgba(255,0,0,0.2)', // Same as fillcolor
                    width: 1
                }
            },
            {
                type: 'rect',
                x0: 1605,
                y0: 0,
                x1: 1615,
                y1: 1,
                xref: 'x',
                yref: 'paper',
                fillcolor: 'rgba(0,0,255,0.2)',
                line: {
                    color: 'rgba(0,0,255,0.2)', // Same as fillcolor
                    width: 1
                }
            }
        ]
    };
    Plotly.react('IUE-spectra-plot', traces, layout, { responsive: true });
}

function generateGridLines() {
    const shapes = [];
    for (let lat = -90; lat <= 90; lat += 30) {
        shapes.push({
            type: 'line', xref: 'x', yref: 'y',
            x0: 0, y0: lat, x1: 360, y1: lat,
            line: { color: 'gray', width: 0.5 }
        });
    }
    for (let lon = 0; lon <= 360; lon += 30) {
        shapes.push({
            type: 'line', xref: 'x', yref: 'y',
            x0: lon, y0: -90, x1: lon, y1: 90,
            line: { color: 'gray', width: 0.5 }
        });
    }
    return shapes;
}

function generateHeatmapTrace() {
    return {
        z: integratedH2Map.z,
        x: integratedH2Map.x,
        y: integratedH2Map.y,
        type: 'heatmap',
        colorscale: 'Viridis',
        showscale: false,
        zmin: 0,
        zmax: 5e5,
        hovertemplate:
            'Value: %{z}<br>' +
            'Galactic Latitude: %{y}°<br>' +
            'Galactic Longitude: %{x}°<extra></extra>'
    };
}

// Plot H2 Spectrum in Channel 1 (1395–1405) and Channel 2 (1605–1615)
function plotH2Channels(latIndex, lonIndex) {

    // Ensure h2EmissionWavelengths and h2EmissionCube are loaded
    if (!h2EmissionWavelengths || !h2EmissionCube) {
        console.error("H2 Emission data is not loaded.");
        return;
    }

    const wav = h2EmissionWavelengths; // length 340
    const fluxArray = h2EmissionCube[latIndex][lonIndex]; // shape [340]

    function extractRange(wav, flux, low, high) {
        const x = [], y = [];
        for (let i = 0; i < wav.length; i++) {
            if (wav[i] >= low && wav[i] <= high) {
                x.push(wav[i]);
                y.push(flux[i]);
            }
        }
        return { x, y };
    }

    const chan1 = extractRange(wav, fluxArray, 1392, 1408);
    const chan2 = extractRange(wav, fluxArray, 1602, 1618);

    const layout1 = {
        xaxis: { title: 'Wavelength (Å)' },
        yaxis: { title: 'Specific Intensity' , showticklabels: false},
        margin: { l: 30, r: 10, t: 30, b: 40 },
        shapes: [
            {
                type: 'rect',
                x0: 1395,
                y0: 0,
                x1: 1405,
                y1: 1,
                xref: 'x',
                yref: 'paper',
                fillcolor: 'rgba(255,0,0,0.2)',
                line: {
                    color: 'rgba(255,0,0,0.2)', // Same as fillcolor
                    width: 1
                }
            }
        ]
    };
    const layout2 = {
        xaxis: { title: 'Wavelength (Å)' },
        yaxis: { title: 'Specific Intensity' , showticklabels: false},
        margin: { l: 30, r: 10, t: 30, b: 40 },
        shapes: [
            {
                type: 'rect',
                x0: 1605,
                y0: 0,
                x1: 1615,
                y1: 1,
                xref: 'x',
                yref: 'paper',
                fillcolor: 'rgba(0,0,255,0.2)',
                line: {
                    color: 'rgba(0,0,255,0.2)', // Same as fillcolor
                    width: 1
                }
            }
        ]
    };

    Plotly.react('h2-spectra-plot-chan1', [{
        x: chan1.x, y: chan1.y, mode: 'lines', type: 'scatter', line: { color: 'black' }
    }], layout1, { responsive: true });

    Plotly.react('h2-spectra-plot-chan2', [{
        x: chan2.x, y: chan2.y, mode: 'lines', type: 'scatter', line: { color: 'black' }
    }], layout2, { responsive: true });
}

// Plot Nighttime Fraction Plot
function plotNighttimeFracPlot(starName) {
    const months = ["O", "N", "D", "J", "F", "M"];
    const data = nighttimeFracMap[starName];

    // Define the trace
    const trace = {
        x: months,
        y: data,
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: 'blue' },
        marker: { color: 'blue' }
    };

    // Define the layout with increased left margin
    const layout = {
        xaxis: {
            tickvals: months,
            ticktext: months,
            showgrid: false,
            showline: false,
            zeroline: false,
            ticks: '',
            showticklabels: true,
            title: ''
        },
        yaxis: {
            range: [-5, 105],
            tickvals: [0, 100],
            ticktext: ["0%", "100%"],
            showgrid: false,
            showline: false,
            zeroline: false,
            ticks: '',
            showticklabels: true,
            title: ''
        },
        margin: { 
            l: 40, // Increased from previous value (e.g., 20) to provide more space
            r: 20, 
            t: 20, 
            b: 20 
        },
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
        showlegend: false
    };

    // Plot using Plotly
    Plotly.react('nighttime-frac-plot', [trace], layout, { responsive: true });
}

/**
 * Converts a flat data array into a 3D nested array based on the provided shape and storage order.
 *
 * @param {Object} cube - The h2EmissionCube object.
 * @param {Array<number>} cube.shape - An array representing the dimensions [dim0, dim1, dim2].
 * @param {boolean} cube.fortranOrder - Boolean indicating the storage order.
 * @param {Array|TypedArray} cube.data - The flat data array containing all elements.
 * @returns {Array<Array<Array>>} - The resulting 3D nested array.
 */
function convertTo3DArray(cube) {
    const [dim0, dim1, dim2] = [180, 360, 340];
  
    // Initialize the 3D array with empty sub-arrays
    const array3D = new Array(dim0);
    for (let h = 0; h < dim0; h++) {
      array3D[h] = new Array(dim1);
      for (let j = 0; j < dim1; j++) {
        array3D[h][j] = new Array(dim2);
      }
    }
  
    // Function to calculate the flat index based on storage order
    const getFlatIndex = false
      ? (h, j, k) => k * dim0 * dim1 + j * dim0 + h
      : (h, j, k) => h * dim1 * dim2 + j * dim2 + k;
  
    // Populate the 3D array
    for (let h = 0; h < dim0; h++) {
      for (let j = 0; j < dim1; j++) {
        for (let k = 0; k < dim2; k++) {
          const flatIndex = getFlatIndex(h, j, k);
          array3D[h][j][k] = cube[flatIndex];
        }
      }
    }
  
    return array3D;
  }

// Handle Plotly Click Events
async function handlePlotClick(data) {
    if (!data.points.length) return;

    const point = data.points[0];

    // If user clicked on a star (scatter)
    if (point.data.type === 'scatter' && point.data.name.includes('Stars')) {
        const starData = point.customdata;
        if (starData) {
            const infoHtml = `
                <strong>Spectral Type:</strong> ${starData.SpectralType}<br>
                <strong>Apparent Magnitude:</strong> ${starData.ApparentMagnitude}<br>
                <strong>Galactic Latitude:</strong> ${starData.GAL_LAT}°<br>
                <strong>Galactic Longitude:</strong> ${starData.GAL_LON}°
            `;
            document.getElementById('star-info').innerHTML = infoHtml;

            currentStarName = starData.Name; // Set the current star's name

            // Plot Nighttime Fraction (always)
            plotNighttimeFracPlot(currentStarName);

            if (starData.HasSpectra) {
                try {
                    const response = await fetch(starData.IUESpectra);
                    if (!response.ok) throw new Error('Spectrum data not found.');
                    const spectrumData = await response.json();
                    currentSpectrumData = spectrumData;

                    // Check normalization checkbox state
                    const normCheckbox = document.getElementById('norm-spectra-checkbox');
                    const normalize = normCheckbox ? normCheckbox.checked : false;

                    // Check show continuum checkbox state
                    const contCheckbox = document.getElementById('show-cont-checkbox');
                    const showContinuum = contCheckbox ? contCheckbox.checked : false;

                    let continuumData = null;
                    if (showContinuum) {
                        continuumData = await loadContinuumData(currentStarName); // Use currentStarName
                        currentContinuumData = continuumData;
                    } else {
                        currentContinuumData = null;
                    }

                    plotSpectrum(spectrumData, normalize, continuumData);
                } catch (error) {
                    displaySpectraMessage("No IUE spectrum available for this star.");
                    currentSpectrumData = null;
                    currentContinuumData = null;

                    // Clear IUE Spectra Plot
                    document.getElementById('IUE-spectra-plot').innerHTML = `
                        <div class="iue-spectrum-message">
                            No IUE spectrum available for this star.
                        </div>
                    `;
                }
            } else {
                displaySpectraMessage("No IUE spectrum available for this star.");
                currentSpectrumData = null;
                currentContinuumData = null;

                // Clear IUE Spectra Plot
                document.getElementById('IUE-spectra-plot').innerHTML = `
                    <div class="iue-spectrum-message">
                        No IUE spectrum available for this star.
                    </div>
                `;
            }

            // **Update selection-info for Selected Star**
            selectedStarNameSpan.textContent = starData.Name;

            // Optionally, reset the lat/lon if desired
            // selectedLatLonSpan.textContent = "N/A";

            return; // Exit early if a star was clicked
        }
    }

    // If user clicked on the background map (heatmap)
    if (point.data.type === 'heatmap') {
        const clickedX = point.x; // Longitude
        const clickedY = point.y; // Latitude

        // Find the closest indices in the integratedH2Map
        const lonIndex = findClosestIndex(integratedH2Map.x, clickedX);
        const latIndex = findClosestIndex(integratedH2Map.y, clickedY);

        // Now, access the flux data from h2EmissionCube
        if (!h2EmissionCube) {
            console.error("H2 Emission Cube data is not loaded.");
            alert("H2 Emission Cube data is not loaded. Please try again later.");
            return;
        }

        // Access the flux array for the given latitude and longitude
        const fluxArray = h2EmissionCube[latIndex][lonIndex]; // Array of 340 flux values
        const wav = h2EmissionWavelengths; // Array of 340 wavelength values

        // Ensure fluxArray and wav have the expected lengths
        if (!fluxArray || fluxArray.length !== wav.length) {
            console.error("Flux array or wavelengths array has unexpected length.");
            alert("Data inconsistency detected. Please contact support.");
            return;
        }

        // Now, proceed to plot H2 channels
        plotH2Channels(latIndex, lonIndex);

        // **Update selection-info for Selected Lat/Lon with Rounding**
        selectedLatLonSpan.textContent = `${Number(clickedY).toFixed(1)}°, ${Number(clickedX).toFixed(1)}°`;

        // Optionally, reset the selected star if desired
        // selectedStarNameSpan.textContent = "N/A";

        // Optionally, hide the H2 spectra plot text and show channels
        hideElement('h2-spectra-plot-text');
    }
}

/**
 * Finds the index of the closest value in an array to the target value.
 * @param {Array<number>} arr - The array to search.
 * @param {number} value - The target value.
 * @returns {number} The index of the closest value.
 */
function findClosestIndex(arr, value) {
    let closestIndex = 0;
    let closestDiff = Math.abs(arr[0] - value);
    for (let i = 1; i < arr.length; i++) {
        const diff = Math.abs(arr[i] - value);
        if (diff < closestDiff) {
            closestDiff = diff;
            closestIndex = i;
        }
    }
    return closestIndex;
}

/**
 * Normalizes an array of flux values by dividing each by the mean flux.
 * @param {Array<number>} flux - The array of flux values to normalize.
 * @returns {Array<number>} The normalized flux values.
 */
function normalizeFlux(flux) {
    const sum = flux.reduce((acc, val) => acc + val, 0);
    const mean = sum / flux.length;
    return flux.map(value => value / mean);
}

/**
 * Displays a message in the IUE spectra plot area.
 * @param {string} message - The message to display.
 */
function displaySpectraMessage(message) {
    document.getElementById('IUE-spectra-plot').innerHTML = `
        <div class="iue-spectrum-message">
            ${message}
        </div>
    `;
}

/**
 * Loads continuum data for a given star.
 * @param {string} starName - The name of the star to load continuum data for.
 * @returns {Object|null} The continuum data if available, otherwise null.
 */
async function loadContinuumData(starName) {
    const fitsFilePath = `static/data/spectra/${starName.replace(/ /g, '_')}_fits.json`;
    try {
        const response = await fetch(fitsFilePath);
        if (!response.ok) throw new Error('Continuum data not found.');
        return await response.json();
    } catch (error) {
        displaySpectraMessage("Continuum data not available for this star.");
        return null;
    }
}

/**
 * Handles selection events (e.g., rectangle or lasso selection) on the scatter plot.
 * Updates the selected stars and refreshes the UI accordingly.
 * @param {Object} eventData - The data object from the Plotly selection event.
 */
function handleSelection(eventData) {
    if (!eventData || !eventData.points.length) {
        selectedStars = [];
        updateSelectedStars();
        return;
    }

    // Extract selected stars' data
    selectedStars = eventData.points.map(point => point.customdata);
    updateSelectedStars();
}

/**
 * Handles deselection events (clearing selections) on the scatter plot.
 * Resets the selected stars and updates the UI.
 * @param {Object} eventData - The data object from the Plotly deselection event.
 */
function handleDeselection(eventData) {
    selectedStars = [];
    updateSelectedStars();
}

/**
 * Updates the 'selected-stars' div with the currently selected stars' information.
 * Shows a table of selected stars or a default message if no stars are selected.
 * Also toggles the visibility of the download button based on selection.
 */
function updateSelectedStars() {
    const selectedStarsDiv = document.getElementById('selected-stars');
    const downloadBtn = document.getElementById('download-btn');
    if (!selectedStarsDiv || !downloadBtn) return;

    if (selectedStars.length === 0) {
        // Display default message when no stars are selected
        selectedStarsDiv.innerHTML = `
            <div class="no-selection">Select stars using rectangle or lasso tool to see information</div>
        `;
        downloadBtn.style.display = 'none'; // Hide the download button
        return;
    }

    // Create table headers
    let html = `
        <table>
            <thead>
                <tr>
                    <th>NAME</th>
                    <th>SP_TYPE</th>
                    <th>m_V</th>
                    <th>GAL_LAT</th>
                    <th>GAL_LON</th>
                </tr>
            </thead>
            <tbody>
    `;

    // Populate table rows with selected stars' data
    selectedStars.forEach(star => {
        html += `
            <tr>
                <td>${star.Name}</td>
                <td>${star.SpectralType}</td>
                <td>${star.ApparentMagnitude}</td>
                <td>${star.GAL_LAT}</td>
                <td>${star.GAL_LON}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    // Update the 'selected-stars' div with the generated table
    selectedStarsDiv.innerHTML = html;
    downloadBtn.style.display = 'block'; // Show the download button
}

/**
 * Initiates the download of selected stars' data as a CSV file.
 * Prompts the user to download the data only if stars are selected.
 */
function downloadSelectedStarsCSV() {
    if (!selectedStars.length) {
        alert("No stars selected to download.");
        return;
    }

    // Define CSV headers
    const headers = ["NAME", "SP_TYPE", "m_V", "GAL_LAT", "GAL_LON"];

    // Map selected stars' data into CSV rows
    const rows = selectedStars.map(star => [
        `"${star.Name}"`,
        `"${star.SpectralType}"`,
        `${star.ApparentMagnitude}`,
        `${star.GAL_LAT}`,
        `${star.GAL_LON}`
    ]);

    // Create CSV content as a string
    const csvContent = headers.join(",") + "\n" + rows.map(r => r.join(",")).join("\n");

    // Create a Blob from the CSV content
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    // Create a temporary link to trigger the download
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "selected_stars.csv");
    link.style.visibility = 'hidden'; // Hide the link element
    document.body.appendChild(link);
    link.click(); // Trigger the download
    document.body.removeChild(link); // Clean up the DOM
}

function init() {
    initializePlots();
}

// Set the init function to run when the window loads
window.onload = init;
