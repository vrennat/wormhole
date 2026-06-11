<script lang="ts" module>
	let _count = 0;
</script>

<script lang="ts">
	let { size = 24 }: { size?: number } = $props();
	const uid = `tg-${_count++}`;
</script>

<span class="inline-flex items-center gap-2 font-display font-semibold tracking-tight">
	<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
		<defs>
			<linearGradient id={uid} x1="0%" y1="100%" x2="100%" y2="0%">
				<stop offset="0%" stop-color="#6b5bd6" />
				<stop offset="100%" stop-color="#4fd6e0" />
			</linearGradient>
		</defs>
		<!-- Circle: the path you were following -->
		<circle cx="13" cy="21" r="8" fill="none" stroke="url(#{uid})" stroke-width="2"/>
		<!-- Tangent line: the moment you go off on one -->
		<line x1="1" y1="20" x2="25" y2="1" stroke="url(#{uid})" stroke-width="2" stroke-linecap="round"/>
		<!-- Dot at the tangent point -->
		<circle cx="7.3" cy="15.3" r="2.2" fill="url(#{uid})"/>
	</svg>
	<span class="text-ink">tangent</span>
</span>
