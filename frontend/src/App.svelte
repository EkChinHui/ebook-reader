<script lang="ts">
  import Sidebar from './components/Sidebar.svelte'
  import Reader from './components/Reader.svelte'
  import AudioPlayer from './components/AudioPlayer.svelte'
</script>

<div class="flex h-screen flex-col bg-parchment-50 text-spine-900">
  <div class="flex flex-1 overflow-hidden">
    <Sidebar />
    <Reader />
  </div>
  <AudioPlayer />
</div>
