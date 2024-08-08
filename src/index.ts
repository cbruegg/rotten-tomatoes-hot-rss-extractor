/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { HTMLElement, parse as parseHTML } from 'node-html-parser';
import { Feed } from 'feed';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const cache = caches.default;
		const match = await cache.match(request);
		if (match !== undefined) {
			console.log('Returning from cache!');
			return match;
		}

		const parsedRequestUrl = new URL(request.url);

		let upstreamUrl: string;
		let typeOfFeed: string;
		switch (parsedRequestUrl.pathname) {
			case '/movies':
				upstreamUrl = 'https://editorial.rottentomatoes.com/guide/popular-movies/';
				typeOfFeed = 'Movies';
				break;
			case '/shows':
				upstreamUrl = 'https://editorial.rottentomatoes.com/guide/popular-tv-shows/';
				typeOfFeed = 'Shows';
				break;
			default:
				return new Response('Not found!', { status: 404 });
		}

		const pageHtml = await (await fetch(upstreamUrl)).text();
		const dom = parseHTML(pageHtml);
		const elements = await parseElements(dom);
		if (elements.length === 0) {
			return new Response('Found no elements!', { status: 500 });
		}
		const brokenElement = elements.find((el) => el.url === undefined);
		if (brokenElement !== undefined) {
			return new Response(`Failed to find a URL for '${brokenElement.title}'`, { status: 500 });
		}

		const feed = toFeed(elements, typeOfFeed, request.url, upstreamUrl);
		// const json = JSON.stringify(elements, null, 4);

		console.log('Serving fresh response');
		const response = new Response(feed.rss2(), {
			headers: {
				'Cache-Control': 'max-age=3600',
			},
		});
		await cache.put(request, response.clone());
		return response;
	},
} satisfies ExportedHandler<Env>;

interface Element {
	title: string;
	timeOfRelease?: string;
	tomatoMeter?: string;
	previewImageUrl?: string;
	synopsis?: string;
	starringText?: string;
	directorText?: string;
	url?: string;
}

async function parseElements(dom: HTMLElement): Promise<Element[]> {
	const elements = dom.querySelectorAll('div.articleContentBody div.row.countdown-item');
	return elements.map((el) => ({
		title: el.querySelector('.article_movie_title a')?.textContent ?? '<TITLE_NOT_FOUND>',
		timeOfRelease: removeParantheses(el.querySelector('.start-year')?.textContent),
		tomatoMeter: el.querySelector('.tMeterScore')?.textContent,
		previewImageUrl: el.querySelector('img.article_poster')?.getAttribute('src'),
		synopsis: el.querySelector('div.synopsis')?.textContent?.trim(),
		starringText: el.querySelector('div.cast')?.textContent?.trim(),
		directorText: el.querySelector('div.director')?.textContent?.trim(),
		url: el.querySelector('.article_movie_title a')?.getAttribute('href'),
	}));
}

function toFeed(elems: Element[], typeOfFeed: string, linkToSelf: string, upstreamUrl: string): Feed {
	const feed = new Feed({
		title: `Hot on RottenTomatoes: ${typeOfFeed}`,
		id: `hot-rottentomatoes-${typeOfFeed}`,
		description: `RSS version of ${upstreamUrl}`,
		copyright: 'Same as RottenTomatoes',
		link: linkToSelf,
	});

	elems.forEach((el) => {
		feed.addItem({
			title: `${el.title} (${el.timeOfRelease}, ${el.tomatoMeter})`,
			id: el.url!,
			link: el.url!,
			description: `${el.synopsis}<br/>${el.starringText}<br/>${el.directorText}`,
			date: new Date(0),
			image: el.previewImageUrl,
		});
	});

	return feed;
}

function removeParantheses(str: string | undefined): string | undefined {
	if (str !== undefined && str.startsWith('(') && str.endsWith(')')) {
		return str.substring(1, str.length - 1);
	} else {
		return str;
	}
}
