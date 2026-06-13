import Foundation

actor ArticleHTMLCache {
	static let shared = ArticleHTMLCache()

	private let capacity = 12
	private var cachedHTML: [String: String] = [:]
	private var order: [String] = []
	private var inFlight: [String: Task<String?, Error>] = [:]

	func html(for title: String) async throws -> String? {
		if let html = cachedHTML[title] {
			return html
		}

		if let task = inFlight[title] {
			return try await task.value
		}

		let task = Task { try await APIClient.shared.article(title: title) }
		inFlight[title] = task

		do {
			let html = try await task.value
			inFlight[title] = nil

			if let html {
				store(html, for: title)
			}

			return html
		} catch {
			inFlight[title] = nil
			throw error
		}
	}

	private func store(_ html: String, for title: String) {
		cachedHTML[title] = html
		order.removeAll { $0 == title }
		order.append(title)

		while order.count > capacity, let evicted = order.first {
			order.removeFirst()
			cachedHTML[evicted] = nil
		}
	}
}
