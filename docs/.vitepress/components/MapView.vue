<script setup lang="ts">
interface MapLocation {
  name: string;
  latitude: number;
  longitude: number;
  description?: string;
}

interface MapProps {
  locations: MapLocation[];
  mapImage: string;
  width?: string;
  height?: string;
}

const props = withDefaults(defineProps<MapProps>(), {
  width: '100%',
  height: '500px'
});

import { ref, onMounted } from 'vue';

const mapContainer = ref<HTMLElement | null>(null);
const isHovering = ref(false);
const currentScale = ref(1);
const rotationDegree = ref(0);

const handleMouseEnter = () => {
  isHovering.value = true;
  animateMap();
};

const handleMouseLeave = () => {
  isHovering.value = false;
  currentScale.value = 1;
  rotationDegree.value = 0;
  if (mapContainer.value) {
    mapContainer.value.style.transform = `scale(1) rotate(0deg)`;
  }
};

const animateMap = () => {
  if (!isHovering.value) return;
  
  // 缓慢增加缩放比例，最大到1.2
  if (currentScale.value < 1.2) {
    currentScale.value += 0.005;
  }
  
  // 缓慢旋转，最大到5度
  if (rotationDegree.value < 5) {
    rotationDegree.value += 0.1;
  }
  
  if (mapContainer.value) {
    mapContainer.value.style.transform = `scale(${currentScale.value}) rotate(${rotationDegree.value}deg)`;
  }
  
  if (isHovering.value) {
    requestAnimationFrame(animateMap);
  }
};

const getLocationStyle = (location: MapLocation) => {
  // 将经纬度转换为相对于地图的位置
  // 这里假设经纬度范围已经标准化为0-100的百分比
  return {
    left: `${location.longitude}%`,
    top: `${location.latitude}%`
  };
};
</script>

<template>
  <div class="map-container" :style="{ width: props.width, height: props.height }">
    <div 
      ref="mapContainer" 
      class="map-image-container"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
    >
      <img :src="mapImage" alt="Campus Map" class="map-image" />
      
      <div 
        v-for="(location, index) in locations" 
        :key="index"
        class="location-marker"
        :style="getLocationStyle(location)"
      >
        <div class="marker-dot"></div>
        <div class="location-tooltip">
          <h4>{{ location.name }}</h4>
          <p v-if="location.description">{{ location.description }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-container {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  margin: 20px 0;
}

.map-image-container {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.3s ease;
  transform-origin: center center;
}

.map-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.location-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 10;
}

.marker-dot {
  width: 12px;
  height: 12px;
  background-color: var(--vp-c-brand);
  border-radius: 50%;
  border: 2px solid white;
  box-shadow: 0 0 0 rgba(var(--vp-c-brand-rgb), 0.4);
  animation: pulse 2s infinite;
  cursor: pointer;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--vp-c-brand-rgb), 0.4);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(var(--vp-c-brand-rgb), 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--vp-c-brand-rgb), 0);
  }
}

.location-tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background-color: white;
  border-radius: 4px;
  padding: 8px 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  width: max-content;
  max-width: 200px;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s, visibility 0.2s;
  pointer-events: none;
  z-index: 20;
}

.location-marker:hover .location-tooltip {
  opacity: 1;
  visibility: visible;
}

.location-tooltip h4 {
  margin: 0 0 4px 0;
  font-size: 14px;
  color: var(--vp-c-text-1);
}

.location-tooltip p {
  margin: 0;
  font-size: 12px;
  color: var(--vp-c-text-2);
}
</style>