export default class Pageable {
  public static MAX_PAGE_SIZE = 1000

  public static async getPageableValues<T>(
    getterFn: (pageIndex: number) => Promise<T[]>,
  ): Promise<T[]> {
    let results: T[] = []
    let queryResults: T[] = []
    let pageIndex: number = 0;
    do {
      queryResults = await getterFn(pageIndex)

      pageIndex += 1;
      results = results.concat(queryResults);

      if (queryResults.length < Pageable.MAX_PAGE_SIZE) {
        break;
      }
    } while (queryResults.length !== 0);

    return results
  }
}
