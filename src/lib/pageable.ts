export default class Pageable {
  public static MAX_PAGE_SIZE = 1000

  public static async getPageableValues<T>(
    getterFn: (lastIndex: number) => Promise<T[]>,
    indexField: string = 'id'
  ): Promise<T[]> {
    let results: T[] = []
    let queryResults: T[] = []
    let lastIndex: number = 0;
    do {
      queryResults = await getterFn(lastIndex)

      lastIndex = queryResults[queryResults.length - 1][indexField];
      results = results.concat(queryResults);

      if (queryResults.length < Pageable.MAX_PAGE_SIZE) {
        break;
      }
    } while (queryResults.length !== 0);

    return results
  }
}
