<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';

interface MapLocation {
  name: string;
  latitude: number;
  longitude: number;
  description?: string;
}

interface MapProps {
  locations: MapLocation[];
  width?: string;
  height?: string;
  initialZoom?: number;
  finalZoom?: number;
  center?: [number, number]; // [经度, 纬度]
  animationDuration?: number;
}

const props = withDefaults(defineProps<MapProps>(), {
  width: '100%',
  height: '500px',
  initialZoom: 12,
  finalZoom: 16,
  center: () => [104.0668, 30.5728], // 成都市中心坐标
  animationDuration: 3000
});

const mapContainer = ref<HTMLElement | null>(null);
const map = ref<any>(null);
const markers = ref<any[]>([]);
let amapScript: HTMLScriptElement | null = null;
let amapUIScript: HTMLScriptElement | null = null;
let amapCssLink: HTMLLinkElement | null = null;
let animationTimer: number | null = null;

// 高德地图API密钥 - 实际使用时应替换为您的密钥
const API_KEY = 'ab728ac490b81b12660829c6cbb0359d'; // 需要替换为实际的高德地图API密钥

const loadAMapScript = () => {
  return new Promise<void>((resolve, reject) => {
    if (window.AMap) {
      resolve();
      return;
    }

    // 加载高德地图CSS
    amapCssLink = document.createElement('link');
    amapCssLink.rel = 'stylesheet';
    amapCssLink.href = 'https://a.amap.com/jsapi_demos/static/demo-center/css/demo-center.css';
    document.head.appendChild(amapCssLink);

    // 加载高德地图JS
    amapScript = document.createElement('script');
    amapScript.src = `https://webapi.amap.com/maps?v=2.0&key=${API_KEY}&plugin=AMap.Scale,AMap.ToolBar`;
    amapScript.async = true;
    amapScript.onload = () => {
      // 加载高德地图UI组件库
      amapUIScript = document.createElement('script');
      amapUIScript.src = 'https://webapi.amap.com/ui/1.1/main.js?v=1.1.1';
      amapUIScript.async = true;
      amapUIScript.onload = () => {
        resolve();
      };
      amapUIScript.onerror = reject;
      document.head.appendChild(amapUIScript);
    };
    amapScript.onerror = reject;
    document.head.appendChild(amapScript);
  });
};

// 检测是否为移动设备
const isMobileDevice = computed(() => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
});

const initMap = async () => {
  if (!mapContainer.value) return;
  
  try {
    await loadAMapScript();
    
    // 创建地图实例
    map.value = new window.AMap.Map(mapContainer.value, {
      viewMode: '3D', // 3D视图
      zoom: props.initialZoom,
      center: props.center,
      mapStyle: 'amap://styles/whitesmoke', // 卫星图
      pitch: 0, // 俯仰角度
      rotation: 0, // 旋转角度
      skyColor: '#1E1E1E', // 天空颜色
      dragEnable: !isMobileDevice.value // 在移动设备上禁用拖动
    });

    // 添加控件 - 在移动设备上不添加工具栏控件
    map.value.addControl(new window.AMap.Scale());
    if (!isMobileDevice.value) {
      map.value.addControl(new window.AMap.ToolBar());
    }

    // 添加卫星图层
    const satellite = new window.AMap.TileLayer.Satellite();
    map.value.add(satellite);

    // 添加路网图层
    const roadNet = new window.AMap.TileLayer.RoadNet();
    map.value.add(roadNet);

    // 添加标记点
    addMarkers();

    // 根据设备类型添加不同的事件监听
    if (isMobileDevice.value) {
      // 移动设备上添加点击事件
      map.value.on('click', startAnimation);
    } else {
      // 桌面设备上添加鼠标悬停事件
      map.value.on('mouseover', startAnimation);
      map.value.on('mouseout', resetMapView);
    }
  } catch (error) {
    console.error('Failed to initialize AMap:', error);
  }
};

const addMarkers = () => {
  if (!map.value) return;
  
  // 清除现有标记
  markers.value.forEach(marker => map.value.remove(marker));
  markers.value = [];

  // 添加新标记
  props.locations.forEach(location => {
    // 创建标记
    const marker = new window.AMap.Marker({
      position: [location.longitude, location.latitude],
      title: location.name,
      animation: 'AMAP_ANIMATION_DROP',
      clickable: true
    });

    // 创建信息窗体
    if (location.description) {
      const infoWindow = new window.AMap.InfoWindow({
        content: `<div class="info-window"><h4>${location.name}</h4><p>${location.description}</p></div>`,
        offset: new window.AMap.Pixel(0, -30)
      });

      // 绑定鼠标事件
      marker.on('mouseover', () => {
        infoWindow.open(map.value, marker.getPosition());
      });

      marker.on('mouseout', () => {
        infoWindow.close();
      });

      marker.on('click', () => {
        infoWindow.open(map.value, marker.getPosition());
      });
    }

    // 将标记添加到地图
    map.value.add(marker);
    markers.value.push(marker);
  });
};

const startAnimation = () => {
  if (!map.value) return;
  
  // 清除之前的动画
  if (animationTimer !== null) {
    cancelAnimationFrame(animationTimer);
    animationTimer = null;
  }

  const startTime = Date.now();
  const startZoom = map.value.getZoom();
  const startPitch = map.value.getPitch();
  const startRotation = map.value.getRotation();
  
  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / props.animationDuration, 1);
    
    // 使用缓动函数使动画更自然
    const easeProgress = easeInOutQuad(progress);
    
    // 计算当前值
    const currentZoom = startZoom + (props.finalZoom - startZoom) * easeProgress;
    const currentPitch = startPitch + (30 - startPitch) * easeProgress; // 最大俯仰角30度
    const currentRotation = startRotation + (45 - startRotation) * easeProgress; // 最大旋转45度
    
    // 应用到地图
    map.value.setZoom(currentZoom);
    map.value.setPitch(currentPitch);
    map.value.setRotation(currentRotation);
    
    if (progress < 1) {
      animationTimer = requestAnimationFrame(animate);
    }
  };
  
  animationTimer = requestAnimationFrame(animate);
};

const resetMapView = () => {
  if (!map.value) return;
  
  // 清除动画
  if (animationTimer !== null) {
    cancelAnimationFrame(animationTimer);
    animationTimer = null;
  }
  
  const startTime = Date.now();
  const startZoom = map.value.getZoom();
  const startPitch = map.value.getPitch();
  const startRotation = map.value.getRotation();
  
  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / 1000, 1); // 重置动画时间为1秒
    
    // 使用缓动函数
    const easeProgress = easeInOutQuad(progress);
    
    // 计算当前值
    const currentZoom = startZoom + (props.initialZoom - startZoom) * easeProgress;
    const currentPitch = startPitch + (0 - startPitch) * easeProgress;
    const currentRotation = startRotation + (0 - startRotation) * easeProgress;
    
    // 应用到地图
    map.value.setZoom(currentZoom);
    map.value.setPitch(currentPitch);
    map.value.setRotation(currentRotation);
    
    if (progress < 1) {
      animationTimer = requestAnimationFrame(animate);
    }
  };
  
  animationTimer = requestAnimationFrame(animate);
};

// 缓动函数
const easeInOutQuad = (t: number): number => {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
};

onMounted(() => {
  initMap();
});

onUnmounted(() => {
  // 清理资源
  if (map.value) {
    map.value.destroy();
  }
  
  // 移除脚本和样式
  if (amapScript && amapScript.parentNode) {
    amapScript.parentNode.removeChild(amapScript);
  }
  
  if (amapUIScript && amapUIScript.parentNode) {
    amapUIScript.parentNode.removeChild(amapUIScript);
  }
  
  if (amapCssLink && amapCssLink.parentNode) {
    amapCssLink.parentNode.removeChild(amapCssLink);
  }
  
  // 清除动画
  if (animationTimer !== null) {
    cancelAnimationFrame(animationTimer);
    animationTimer = null;
  }
});

// 为TypeScript声明全局AMap对象
declare global {
  interface Window {
    AMap: any;
    AMapUI: any;
  }
}
</script>

<template>
  <div class="amap-container" :style="{ width: props.width, height: props.height }">
    <div ref="mapContainer" class="amap-instance"></div>
    <div class="map-tip">
      <p v-if="isMobileDevice">点击地图可查看卫星图并放大旋转</p>
      <p v-else>鼠标悬停在地图上可查看卫星图并放大旋转</p>
    </div>
  </div>
</template>

<style scoped>
.amap-container {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  margin: 20px 0;
}

.amap-instance {
  width: 100%;
  height: 100%;
}

.map-tip {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background-color: rgba(255, 255, 255, 0.8);
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  z-index: 100;
}

.info-window h4 {
  margin: 0 0 5px 0;
  padding: 0.2em 0;
  font-size: 14px;
}

.info-window p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
</style>