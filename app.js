let map;
let markers = [];
let destinations = [];
let autocomplete;
let destinationCoords = [];
let fixedDestinations = new Set();

function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: {lat: 0, lng: 0},
        zoom: 2
    });

    const input = document.getElementById('destination-input');
    autocomplete = new google.maps.places.Autocomplete(input);

    document.getElementById('add-destination').addEventListener('click', () => {
        addDestination();
        updateDestinationList();
    });
    document.getElementById('optimize-route').addEventListener('click', () => optimizeRoute());
    document.getElementById('reset-route').addEventListener('click', () => {
        resetRoute();
        updateDestinationList();
    });

    console.log("Map initialized");
}

function addDestination() {
    const place = autocomplete.getPlace();
    if (!place || !place.geometry) {
        alert("Please select a place from the dropdown.");
        return;
    }

    const address = place.formatted_address;
    destinations.push(address);
    destinationCoords.push(place.geometry.location.toJSON());
    addMarker(place.geometry.location);
    document.getElementById('destination-input').value = '';

    console.log("Destination added:", address);
}

function addMarker(location) {
    const marker = createFlagMarker(location, (markers.length + 1).toString());
    markers.push(marker);
    map.setCenter(location);
    map.setZoom(10);
}

function getDistance(origin, destination) {
    return new Promise((resolve, reject) => {
        const service = new google.maps.DirectionsService();
        service.route(
            {
                origin: origin,
                destination: destination,
                travelMode: google.maps.TravelMode.DRIVING
            },
            (response, status) => {
                if (status === 'OK') {
                    const route = response.routes[0];
                    resolve({
                        distance: route.legs[0].distance.value, // in meters
                        duration: route.legs[0].duration.value // in seconds
                    });
                } else {
                    reject(new Error(`Directions request failed: ${status}`));
                }
            }
        );
    });
}

async function calculateRouteMetric(route, optimizationType) {
    let totalDistance = 0;
    let totalDuration = 0;

    for (let i = 0; i < route.length - 1; i++) {
        const result = await getDistance(destinationCoords[route[i]], destinationCoords[route[i + 1]]);
        totalDistance += result.distance;
        totalDuration += result.duration;
    }

    return optimizationType === 'distance' ? totalDistance : totalDuration;
}

async function flexibleTSP(coords, optimizationType) {
    const n = coords.length;
    const fixedIndices = Array.from(fixedDestinations).sort((a, b) => a - b);
    const flexibleIndices = Array.from({length: n}, (_, i) => i).filter(i => !fixedDestinations.has(i));
    
    let bestRoute = [];
    let bestMetric = Infinity;

    async function permute(arr, start = 0) {
        if (start === arr.length) {
            const fullRoute = [];
            let j = 0;
            for (let i = 0; i < n; i++) {
                if (fixedDestinations.has(i)) {
                    fullRoute.push(i);
                } else {
                    fullRoute.push(arr[j++]);
                }
            }
            const metric = await calculateRouteMetric(fullRoute, optimizationType);
            if (metric < bestMetric) {
                bestMetric = metric;
                bestRoute = fullRoute;
            }
        } else {
            for (let i = start; i < arr.length; i++) {
                [arr[start], arr[i]] = [arr[i], arr[start]];
                await permute(arr, start + 1);
                [arr[start], arr[i]] = [arr[i], arr[start]];
            }
        }
    }

    await permute(flexibleIndices);
    return bestRoute;
}

async function optimizeRoute() {
    const optimizationType = document.querySelector('input[name="optimize"]:checked').value;
    if (destinations.length < 2) {
        alert("Please add at least two destinations.");
        return;
    }

    try {
        const optimizedRoute = await flexibleTSP(destinationCoords, optimizationType);
        displayOptimizedRoute(optimizedRoute);
    } catch (error) {
        console.error("Optimization failed:", error);
        alert("Failed to optimize route. Please try again.");
    }
}

function displayOptimizedRoute(route) {
    console.log("Displaying optimized route", route);

    // Clear existing route
    markers.forEach(marker => marker.setMap(null));
    markers = [];

    // Remove existing polyline if any
    if (window.currentPolyline) {
        window.currentPolyline.setMap(null);
    }

    // Create a new PolylineOptions object
    const lineSymbol = {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW
    };
    const polylineOptions = {
        path: route.map(index => destinationCoords[index]),
        geodesic: true,
        strokeColor: '#0000FF', // Changed to orange
        strokeOpacity: 1.0,
        strokeWeight: 2,
        icons: [{
            icon: lineSymbol,
            offset: '100%',
            repeat: '100px'
        }]
    };

    // Create the polyline and add it to the map
    const polyline = new google.maps.Polyline(polylineOptions);
    polyline.setMap(map);
    window.currentPolyline = polyline;

    // Add flag markers for each destination
    route.forEach((index, i) => {
        const marker = createFlagMarker(destinationCoords[index], (i + 1).toString());
        markers.push(marker);
    });

    // Fit the map to show all markers
    const bounds = new google.maps.LatLngBounds();
    markers.forEach(marker => bounds.extend(marker.getPosition()));
    map.fitBounds(bounds);

    console.log("Route displayed, markers added:", markers.length);

    // Update the destination list with the optimized order
    updateDestinationList(route);
}

function updateDestinationList(route) {
    const list = document.getElementById('destination-list');
    list.innerHTML = '';
    (route || destinations.map((_, i) => i)).forEach((index, i) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="drag-handle">☰</span>
            <input type="checkbox" id="fix-${index}" ${fixedDestinations.has(index) ? 'checked' : ''}>
            <label for="fix-${index}">${i + 1}. ${destinations[index]}</label>
        `;
        li.draggable = true;
        li.dataset.index = index;
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
            if (e.target.checked) {
                fixedDestinations.add(index);
            } else {
                fixedDestinations.delete(index);
            }
        });
        list.appendChild(li);
    });
}

function resetRoute() {
    destinations = [];
    destinationCoords = [];
    fixedDestinations.clear();
    markers.forEach(marker => marker.setMap(null));
    markers = [];
    if (window.currentPolyline) {
        window.currentPolyline.setMap(null);
    }
    map.setCenter({lat: 0, lng: 0});
    map.setZoom(2);
    document.getElementById('destination-input').value = '';
}

function createFlagMarker(position, label, color = "#00C853") {
    const flagSVG = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
      <path d="M12,0 C5.372583,0 0,5.372583 0,12 C0,21 12,36 12,36 C12,36 24,21 24,12 C24,5.372583 18.627417,0 12,0 Z" fill="${color}"/>
      <text x="12" y="16" font-family="Arial" font-size="12" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text>
    </svg>`;

    return new google.maps.Marker({
        position: position,
        map: map,
        icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(flagSVG),
            scaledSize: new google.maps.Size(24, 36),
            anchor: new google.maps.Point(12, 36)
        },
        label: ''
    });
}

function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', e.target.dataset.index);
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e) {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
    const toIndex = parseInt(e.target.closest('li').dataset.index);
    if (fromIndex !== toIndex) {
        const item = destinations.splice(fromIndex, 1)[0];
        destinations.splice(toIndex, 0, item);
        const coord = destinationCoords.splice(fromIndex, 1)[0];
        destinationCoords.splice(toIndex, 0, coord);
        updateDestinationList();
        if (window.currentPolyline) {
            displayOptimizedRoute(destinations.map((_, i) => i));
        }
    }
}