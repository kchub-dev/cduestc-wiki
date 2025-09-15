<script setup lang="ts">
import type { Lab } from '../../utils/lab'
import { computed, ref } from 'vue'
import { getAvatar } from '../../utils/lab'
import Link from '../Link.vue'

const props = defineProps<Lab>()
const avatar = computed(() => getAvatar(props))

// note展开状态
const isNoteExpanded = ref(false)

const toggleNoteExpanded = () => {
    isNoteExpanded.value = !isNoteExpanded.value
}
</script>

<template>
    <div class="card">
        <div class="card-face">
            <img class="blur-bg" :src="avatar" alt="">

            <div class="banner">
                <img class="avatar" :src="avatar" alt="">
            </div>

            <div class="name">
                {{ name }}
            </div>

            <div class="tag-line">
                <Badge v-for="tag in tags.split(',')" :key="tag" :text="tag" />
            </div>
        </div>

        <div class="card-back">
            <img class="blur-bg" :src="avatar" alt="">

            <div class="id">
                {{ id }}
            </div>

            <div class="name">
                {{ name }}
            </div>

            <div class="link-line">
                <Link v-if="github" v-tip="`@${github}`" icon="ri:github-fill" :link="`https://github.com/${github}`" />
                <Link v-if="website" icon="ri:global-fill" :link="website" text="官网" />
                <Link v-if="plan" icon="ri:book-2-line" :link="plan" text="培养计划" />
            </div>

            <div class="info">
                <Link v-if="belong" icon="ri:building-line" :text="belong" />
                <Link v-if="addr" icon="ri:map-pin-2-line" :text="addr" />
                <Link v-if="join" icon="ri:calendar-line" :text="`招新时间: ${join}`" />
                <Link v-if="qq" icon="ri:qq-fill" copy :text="qq" />
                <div v-if="note" class="note-item" @click="toggleNoteExpanded">
                    <Icon icon="ri:message-2-line" />
                    <span class="note-content" :class="{ expanded: isNoteExpanded }">{{ note }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.card {
    display: grid;
    position: relative;
    perspective: 50rem;
}

.card-face, .card-back {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    position: relative;
    overflow: hidden;
    padding: 1rem;
    border-radius: 0.5em;
    background-color: var(--vp-c-bg-soft);
    /* stylelint-disable-next-line property-no-vendor-prefix */
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
    transition: transform 0.3s;
    z-index: 0;
}

.card-back {
    position: absolute;
    inset: 0;
    transform: rotateY(-180deg);
}

.card:hover .card-face {
    transform: rotateY(180deg);
}

.card:hover .card-back {
    transform: rotateY(0);
}

.blur-bg {
    position: absolute;
    width: 100%;
    transform: scale(1.2);
    transition: all 0.2s;
    filter: saturate(2) contrast(0.5) blur(3em);
    mix-blend-mode: color;
    pointer-events: none;
    z-index: -1;
}

.card-back .blur-bg {
    transform: scale(-1.2, 1.2);
}

.avatar {
    width: 5rem;
    height: 5rem;
    margin: 0.5rem 0;
    border-radius: 4rem;
}

.name {
    font-weight: bold;
}

.tag-line {
    flex-grow: 1;
    margin: 0.5rem;
    font-size: 0.9em;
    text-align: center;
}

.id {
    position: absolute;
    top: 0;
    font-size: 4em;
    font-weight: bold;
    line-height: 1.5;
    white-space: nowrap;
    mix-blend-mode: color-burn;
    user-select: none;
    z-index: -1;
}

.link-line {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.9em;
}

.info {
    display: grid;
    gap: 0.4rem;
    opacity: 0.7;
    width: 90%;
    font-size: 0.9em;
}

.note-item {
    display: inline-flex;
    gap: 0.2em;
    line-height: 1.4;
    align-items: flex-start;
    cursor: pointer;
    transition: all 0.2s ease;
}

.note-item:hover {
    opacity: 1;
}

.note-item .iconify {
    height: 1.2em;
    margin-top: 0.1em;
    flex-shrink: 0;
}

.note-content {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    word-wrap: break-word;
    word-break: break-word;
    line-height: 1.4;
    transition: all 0.3s ease;
}

.note-content.expanded {
    display: block;
    -webkit-line-clamp: unset;
    line-clamp: unset;
    overflow: visible;
}

/* 桌面端悬停效果 */
@media (hover: hover) {
    .note-item:hover .note-content {
        display: block;
        -webkit-line-clamp: unset;
        line-clamp: unset;
        overflow: visible;
        background: var(--vp-c-bg-soft);
        padding: 0.2rem 0.4rem;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        position: relative;
        z-index: 10;
    }
}
</style>