export default class Pageable {
  public static MAX_PAGE_SIZE = 1000

  public static async getPageableValues<T>(
    getterFn: (lastIndex: number) => Promise<T[]>,
  ): Promise<T[]> {
    let results: T[] = []
    let queryResults: T[] = []
    let lastIndex: number = 0;
    do {
      queryResults = await getterFn(lastIndex)

      if (queryResults.length == 0) {
        break;
      }

      lastIndex = queryResults[queryResults.length - 1]['id'];
      results = results.concat(queryResults);

      if (queryResults.length < Pageable.MAX_PAGE_SIZE) {
        break;
      }
    } while (queryResults.length !== 0);

    return results
  }
}
