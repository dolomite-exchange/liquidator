export default class Pageable {
  public static MAX_PAGE_SIZE = 1000

  public static async getPageableValues<T>(
    getterFn: (lastId: string | undefined) => Promise<T[]>,
  ): Promise<T[]> {
    let results: T[] = []
    let queryResults: T[] = []
    let lastValue: string | undefined = undefined;
    do {
      queryResults = await getterFn(lastValue)

      if (queryResults.length === 0) {
        break;
      }

      lastValue = queryResults[queryResults.length - 1]['id'];
      results = results.concat(queryResults);
    } while (queryResults.length !== 0 && queryResults.length === Pageable.MAX_PAGE_SIZE);

    return results
  }
}
