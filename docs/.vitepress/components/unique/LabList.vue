<script setup lang="ts">
import { onMounted, ref } from 'vue'
import LabList from '../../data/labs.json'
import LabItem from './LabItem.vue'

const labs = ref([...LabList])

const shuffleLabs = () => labs.value.sort(() => Math.random() - 0.5)

onMounted(shuffleLabs)
</script>

<template>
    <h1 class="center-line">
        西邮实验室/兴趣小组/工作室列表
        <Icon class="shuffle-btn" icon="ri:shuffle-fill" @click="shuffleLabs" />
    </h1>
    <div class="center-line">
        修改信息请联系 QQ 2399052066
    </div>
    <TransitionGroup tag="section" class="lab-list">
        <LabItem v-for="lab in labs" v-bind="lab" :key="lab.id" />
    </TransitionGroup>
</template>

<style scoped>
.lab-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 1rem;
}

.center-line {
    margin: 1em 0 1rem;
    text-align: center;
}

.shuffle-btn {
    cursor: pointer;
}

.v-move {
    transition: transform 0.5s;
}
</style>
